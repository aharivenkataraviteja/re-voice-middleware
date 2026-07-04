-- Row-Level Security: every tenant-scoped table only returns rows matching
-- the current session's app.tenant_id, set by withTenant() in src/db/client.ts.
-- This is the actual enforcement mechanism, not just an application-level
-- convention — a query that forgets to scope by tenant_id still can't leak
-- another tenant's rows.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "timeline_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sms_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "users"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "leads"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "calls"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "appointments"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "tasks"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "timeline_events"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON "sms_log"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- audit_log.tenant_id is nullable (platform-level events have no tenant),
-- so also allow rows where tenant_id IS NULL through, in addition to the
-- current tenant's own rows.
CREATE POLICY tenant_isolation ON "audit_log"
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.tenant_id', true)::uuid);
