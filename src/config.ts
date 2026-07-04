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
};
