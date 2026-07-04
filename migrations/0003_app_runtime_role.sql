-- Dedicated non-superuser application role. The Railway-provisioned
-- "postgres" user is a superuser with BYPASSRLS, which means RLS policies
-- (even FORCE'd ones) never apply to it, confirmed by a real cross-tenant
-- read test that leaked data under that role. The application must connect
-- as this restricted role at runtime for tenant isolation to mean anything;
-- the superuser connection is reserved for running migrations only.
--
-- SECURITY: this placeholder password must be rotated immediately after
-- this migration runs in any environment — `ALTER ROLE app_runtime WITH
-- PASSWORD '<new random value>'` — and the real value only ever lives in
-- APP_DATABASE_URL as a deployment secret, never in a committed file. (An
-- earlier real password was briefly committed to this file and has since
-- been rotated away from — it is no longer valid.)

CREATE ROLE app_runtime WITH LOGIN PASSWORD 'CHANGEME_ROTATE_IMMEDIATELY_AFTER_MIGRATION';
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
