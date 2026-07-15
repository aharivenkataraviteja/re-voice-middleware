import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  mockMode: (process.env.MOCK_MODE || "true").toLowerCase() === "true",
  vapiToolSecret: required("VAPI_TOOL_SECRET"),
  vapiWebhookSecret: required("VAPI_WEBHOOK_SECRET"),
  // Superuser connection — migrations only. Never used for application queries;
  // RLS policies do not apply to it (see APP_DATABASE_URL below).
  databaseUrl: required("DATABASE_URL"),
  // Restricted app_runtime role — no BYPASSRLS, no superuser. All application
  // request-handling queries must go through this connection for tenant
  // isolation to actually be enforced.
  appDatabaseUrl: required("APP_DATABASE_URL"),
  jwtPrivateKey: Buffer.from(required("JWT_PRIVATE_KEY_B64"), "base64").toString("utf-8"),
  jwtPublicKey: Buffer.from(required("JWT_PUBLIC_KEY_B64"), "base64").toString("utf-8"),
  // Release 1.0 is single-tenant (Luxury Partners Realty). VAPI webhook/tool
  // payloads carry no tenant identifier of their own, so every call from
  // Alex is attributed to this one tenant. Onboarding tenant #2 means
  // resolving tenant_id from the called phone number instead — deferred
  // until there's a second real tenant to route for.
  tenantId: required("TENANT_ID"),
  // Google Calendar integration is optional at the process level — the app
  // must still boot and serve the mock-slot fallback if these aren't set
  // yet (e.g. before pilot setup, or for a tenant that never connects
  // Google). Individual agents' connection status is what actually gates
  // real-vs-mock behavior per request, not whether these env vars exist.
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
  googleTokenEncryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  // Off by default. Set only for the duration of a single deliberate test
  // call validating assistant-request's timeout fallback (see
  // src/routes/assistantRequest.ts) — forces the caller-history lookup to
  // exceed its timeout so the real fallback path runs end-to-end, then
  // unset immediately after. Never left on.
  assistantRequestForceTimeout: (process.env.ASSISTANT_REQUEST_FORCE_TIMEOUT || "false").toLowerCase() === "true",
  get googleConfigured(): boolean {
    return Boolean(
      this.googleClientId && this.googleClientSecret && this.googleRedirectUri && this.googleTokenEncryptionKey
    );
  },
};
