import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { config } from "../config";

// Runtime queries use the restricted app_runtime role (config.appDatabaseUrl),
// never the superuser DATABASE_URL — RLS does not apply to a superuser/
// BYPASSRLS role, confirmed by a real cross-tenant read test that leaked
// data before this was fixed. See migrations/0003_app_runtime_role.sql.
const client = postgres(config.appDatabaseUrl, { max: 10 });

export const db = drizzle(client, { schema });

export type TenantScopedDb = PostgresJsDatabase<typeof schema>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sets the Postgres session variable RLS policies check against, then hands
 * the caller the transaction-scoped db handle. Every tenant-scoped query
 * MUST run against the `tx` passed into `fn`, not the module-level `db` —
 * querying `db` directly bypasses the SET LOCAL and therefore the RLS scope.
 *
 * tenantId is validated as a UUID (not parameterized) because PostgreSQL's
 * SET LOCAL does not accept bind parameters — this format check is the
 * injection guard in place of parameterization.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantScopedDb) => Promise<T>
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) {
    throw new Error(`Invalid tenantId: ${tenantId}`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(`set local app.tenant_id = '${tenantId}'`);
    return fn(tx as unknown as TenantScopedDb);
  });
}
