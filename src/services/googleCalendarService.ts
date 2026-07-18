import { google } from "googleapis";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { TenantScopedDb } from "../db/client";
import { config } from "../config";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";

// Least-privilege: freebusy for availability, events for booking — no
// broader calendar/calendar.readonly scope requested. See
// GOOGLE_CALENDAR_SETUP.md for why these specific four.
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
];

export function createOAuthClient() {
  if (!config.googleConfigured) {
    throw new Error("google_not_configured");
  }
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
}

export function buildAuthUrl(state: string): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // required to receive a refresh_token at all
    prompt: "consent", // force the consent screen every time so a re-connect always yields a fresh refresh_token
    scope: GOOGLE_OAUTH_SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string; email?: string }> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    // Google only issues a refresh_token on first consent (or when
    // prompt=consent forces re-consent, which buildAuthUrl always sets) —
    // if this ever fires it means that safeguard didn't work as expected.
    throw new Error("no_refresh_token_returned");
  }

  let email: string | undefined;
  if (tokens.id_token) {
    try {
      const payloadB64 = tokens.id_token.split(".")[1];
      const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
      email = payload.email;
    } catch {
      // Display-only field — a parse failure here shouldn't fail the connection.
    }
  }

  return { refreshToken: tokens.refresh_token, email };
}

export async function getConnection(tx: TenantScopedDb, agentId: string) {
  const [conn] = await tx
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.agentId, agentId));
  return conn ?? null;
}

export async function getAnyConnectedAgentId(tx: TenantScopedDb): Promise<string | null> {
  const [conn] = await tx
    .select({ agentId: schema.calendarConnections.agentId })
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.status, "connected"))
    .limit(1);
  return conn?.agentId ?? null;
}

async function getAuthorizedClient(connection: typeof schema.calendarConnections.$inferSelect) {
  if (!connection.refreshTokenEncrypted) {
    throw new Error("no_refresh_token_stored");
  }
  const client = createOAuthClient();
  const refreshToken = decryptToken(connection.refreshTokenEncrypted);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export interface FreeBusyPeriod {
  start: string;
  end: string;
}

// Throws on any Google API failure (including a revoked/expired refresh
// token) — callers are responsible for catching this and falling back to
// log_callback_request, per the "never remove the safety net" requirement.
export async function checkFreeBusy(
  connection: typeof schema.calendarConnections.$inferSelect,
  timeMin: Date,
  timeMax: Date
): Promise<FreeBusyPeriod[]> {
  const client = await getAuthorizedClient(connection);
  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      items: [{ id: connection.calendarId }],
    },
  });
  const busy = res.data.calendars?.[connection.calendarId]?.busy ?? [];
  return busy.map((b) => ({ start: b.start!, end: b.end! }));
}

export interface CreateEventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timeZone: string;
  attendeeEmail?: string;
}

export async function createCalendarEvent(
  connection: typeof schema.calendarConnections.$inferSelect,
  event: CreateEventInput
): Promise<string> {
  const client = await getAuthorizedClient(connection);
  const calendar = google.calendar({ version: "v3", auth: client });
  const res = await calendar.events.insert({
    calendarId: connection.calendarId,
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
      end: { dateTime: event.end.toISOString(), timeZone: event.timeZone },
      attendees: event.attendeeEmail ? [{ email: event.attendeeEmail }] : undefined,
    },
  });
  if (!res.data.id) throw new Error("google_event_creation_failed");
  return res.data.id;
}

// Encrypts and upserts a connection row after a successful OAuth exchange.
export async function saveConnection(
  tx: TenantScopedDb,
  tenantId: string,
  agentId: string,
  refreshToken: string,
  email: string | undefined
) {
  const existing = await getConnection(tx, agentId);
  const encrypted = encryptToken(refreshToken);
  if (existing) {
    await tx
      .update(schema.calendarConnections)
      .set({
        refreshTokenEncrypted: encrypted,
        googleAccountEmail: email,
        status: "connected",
        lastError: null,
        connectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.calendarConnections.id, existing.id));
  } else {
    await tx.insert(schema.calendarConnections).values({
      tenantId,
      agentId,
      provider: "google",
      googleAccountEmail: email,
      calendarId: "primary",
      refreshTokenEncrypted: encrypted,
      status: "connected",
      connectedAt: new Date(),
    });
  }
}

// Distinguishes "the refresh token itself is dead — a human must go through
// Google's consent screen again" from every other kind of Google API
// failure (network blip, rate limit, transient 5xx). Observed in
// production: a single expired-token incident (invalid_grant) was
// indistinguishable, in the old code, from a one-off network hiccup — both
// flipped the dashboard to "Needs reconnect." That's a false alarm for
// anything transient, and reconnecting doesn't fix a transient failure
// anyway. Only a genuine auth-layer signal (invalid_grant/invalid_client/
// unauthorized_client from the token endpoint, or a bare 401) should ever
// tell an agent they need to click through Google's consent screen again.
export function isReconnectRequiredError(err: unknown): boolean {
  const anyErr = err as any;
  const oauthErrorCode: string | undefined = anyErr?.response?.data?.error;
  if (oauthErrorCode && ["invalid_grant", "invalid_client", "unauthorized_client"].includes(oauthErrorCode)) {
    return true;
  }
  if (anyErr?.response?.status === 401 || anyErr?.code === 401) {
    return true;
  }
  const message: string = anyErr?.message || "";
  return /invalid_grant|invalid_client|unauthorized_client|token has been expired or revoked/i.test(message);
}

// Marks a connection as needing reconnect without deleting history — surfaced
// on the dashboard so an agent knows to reconnect rather than silently
// falling back to the callback safety net forever. Callers should gate this
// behind isReconnectRequiredError — see its comment for why.
export async function markConnectionError(tx: TenantScopedDb, agentId: string, message: string) {
  await tx
    .update(schema.calendarConnections)
    .set({ status: "error", lastError: message, updatedAt: new Date() })
    .where(eq(schema.calendarConnections.agentId, agentId));
}
