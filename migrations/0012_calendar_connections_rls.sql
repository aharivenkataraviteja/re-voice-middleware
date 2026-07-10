ALTER TABLE "calendar_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_connections" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "calendar_connections"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "calendar_connections" TO app_runtime;
