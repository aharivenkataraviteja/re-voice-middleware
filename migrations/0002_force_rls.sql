-- Postgres exempts the table owner from RLS policies by default, and our
-- application connects as that same owner role (the one that ran the
-- migrations). Without FORCE, the tenant_isolation policies added in
-- 0001 are silently bypassed for every query the app makes — confirmed by
-- a real cross-tenant read test that failed prior to this migration.

ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;
ALTER TABLE "calls" FORCE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "timeline_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "sms_log" FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
