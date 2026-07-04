ALTER TABLE "coach_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "coach_notes" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "coach_notes"
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "coach_notes" TO app_runtime;
