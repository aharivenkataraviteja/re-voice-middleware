import { Router } from "express";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { config } from "../../config";
import { signOAuthStateToken, verifyOAuthStateToken } from "../../services/authService";
import { buildAuthUrl, exchangeCodeForTokens, saveConnection, getConnection } from "../../services/googleCalendarService";

export const googleCalendarRouter = Router();

// Where the browser lands after the OAuth round-trip completes (success or
// failure) — the dashboard reads ?google=connected|error off this route.
const POST_CONNECT_REDIRECT = "/calendar";

// Returns the Google auth URL as JSON rather than redirecting server-side —
// this route requires our Bearer access token (in-memory only, never a
// cookie, per the frontend's XSS-hardening choice), so a plain browser
// navigation here would carry no auth at all and 401. The frontend calls
// this via an authenticated fetch, then navigates the browser itself.
googleCalendarRouter.get(
  "/api/v1/integrations/google-calendar/connect",
  requireAuth,
  (req, res) => {
    if (!config.googleConfigured) {
      return res.status(501).json({ error: "google_calendar_not_configured", code: "NOT_CONFIGURED" });
    }
    const state = signOAuthStateToken({ sub: req.user!.sub, tenantId: req.user!.tenantId });
    const url = buildAuthUrl(state);
    res.status(200).json({ url });
  }
);

// Public — Google redirects the agent's browser here directly with no auth
// header/cookie of ours attached. The signed `state` param (10 min TTL) is
// what identifies which user is connecting; see authService.ts.
googleCalendarRouter.get("/api/v1/integrations/google-calendar/oauth/callback", async (req, res) => {
  const { code, state, error: googleError } = req.query;

  if (googleError) {
    console.error(`[google-calendar] OAuth denied/error from Google: ${googleError}`);
    return res.redirect(`${POST_CONNECT_REDIRECT}?google=error&reason=denied`);
  }

  if (typeof code !== "string" || typeof state !== "string") {
    console.error("[google-calendar] OAuth callback missing code or state");
    return res.redirect(`${POST_CONNECT_REDIRECT}?google=error&reason=missing_params`);
  }

  let claims;
  try {
    claims = verifyOAuthStateToken(state);
  } catch (err) {
    console.error("[google-calendar] OAuth callback: invalid or expired state token", err);
    return res.redirect(`${POST_CONNECT_REDIRECT}?google=error&reason=invalid_state`);
  }

  try {
    const { refreshToken, email } = await exchangeCodeForTokens(code);
    await withTenant(claims.tenantId, (tx) => saveConnection(tx, claims.tenantId, claims.sub, refreshToken, email));
    console.log(`[google-calendar] connected agent=${claims.sub} email=${email ?? "unknown"}`);
    res.redirect(`${POST_CONNECT_REDIRECT}?google=connected`);
  } catch (err) {
    console.error(`[google-calendar] token exchange failed for agent=${claims.sub}`, err);
    res.redirect(`${POST_CONNECT_REDIRECT}?google=error&reason=token_exchange_failed`);
  }
});

googleCalendarRouter.get("/api/v1/integrations/google-calendar/status", requireAuth, async (req, res, next) => {
  try {
    const connection = await withTenant(req.user!.tenantId, (tx) => getConnection(tx, req.user!.sub));
    if (!connection) {
      return res.status(200).json({ connected: false });
    }
    res.status(200).json({
      connected: connection.status === "connected",
      status: connection.status,
      googleAccountEmail: connection.googleAccountEmail,
      calendarId: connection.calendarId,
      lastError: connection.lastError,
      connectedAt: connection.connectedAt,
    });
  } catch (err) {
    next(err);
  }
});

googleCalendarRouter.get(
  "/api/v1/integrations/google-calendar/team-status",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res, next) => {
    try {
      const rows = await withTenant(req.user!.tenantId, (tx) =>
        tx
          .select({
            agentId: schema.users.id,
            agentName: schema.users.fullName,
            agentEmail: schema.users.email,
            role: schema.users.role,
            status: schema.calendarConnections.status,
            googleAccountEmail: schema.calendarConnections.googleAccountEmail,
            lastError: schema.calendarConnections.lastError,
            connectedAt: schema.calendarConnections.connectedAt,
          })
          .from(schema.users)
          .leftJoin(schema.calendarConnections, eq(schema.calendarConnections.agentId, schema.users.id))
      );
      res.status(200).json({
        agents: rows.map((r) => ({
          agentId: r.agentId,
          agentName: r.agentName,
          agentEmail: r.agentEmail,
          role: r.role,
          connected: r.status === "connected",
          status: r.status ?? "disconnected",
          googleAccountEmail: r.googleAccountEmail,
          lastError: r.lastError,
          connectedAt: r.connectedAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

googleCalendarRouter.post(
  "/api/v1/integrations/google-calendar/disconnect",
  requireAuth,
  async (req, res, next) => {
    try {
      const result = await withTenant(req.user!.tenantId, async (tx) => {
        const existing = await getConnection(tx, req.user!.sub);
        if (!existing) return null;
        await tx
          .update(schema.calendarConnections)
          .set({ status: "disconnected", refreshTokenEncrypted: null, lastError: null, updatedAt: new Date() })
          .where(eq(schema.calendarConnections.id, existing.id));
        return true;
      });
      if (!result) return res.status(404).json({ error: "not_connected", code: "NOT_FOUND" });
      res.status(200).json({ disconnected: true });
    } catch (err) {
      next(err);
    }
  }
);
