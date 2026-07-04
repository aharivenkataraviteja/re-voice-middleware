import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { withTenant } from "./client";
import { config } from "../config";

async function main() {
  const adminClient = postgres(config.databaseUrl, { max: 1 });
  const adminDb = drizzle(adminClient, { schema });

  // Use an unprivileged application role check: withTenant() runs queries
  // through the same pooled connection the app uses, so this test exercises
  // the actual RLS policy, not just a hand-verified assumption about it.

  const [tenantA] = await adminDb
    .insert(schema.tenants)
    .values({ brokerageName: "Tenant A Realty", subdomain: "tenant-a", primaryContactEmail: "a@example.com" })
    .returning();
  const [tenantB] = await adminDb
    .insert(schema.tenants)
    .values({ brokerageName: "Tenant B Realty", subdomain: "tenant-b", primaryContactEmail: "b@example.com" })
    .returning();

  await adminDb.insert(schema.leads).values({ tenantId: tenantA.id, callerName: "Lead A", intent: "buy" });
  await adminDb.insert(schema.leads).values({ tenantId: tenantB.id, callerName: "Lead B", intent: "sell" });

  const asTenantA = await withTenant(tenantA.id, async (tx) => {
    return tx.select().from(schema.leads);
  });

  console.log("Rows visible as tenant A:", asTenantA.length, asTenantA.map((l) => l.callerName));

  const leakedTenantB = asTenantA.some((l) => l.tenantId === tenantB.id);

  if (asTenantA.length === 1 && asTenantA[0].callerName === "Lead A" && !leakedTenantB) {
    console.log("PASS: RLS correctly scoped tenant A to only its own lead.");
  } else {
    console.error("FAIL: tenant isolation did not hold.", { asTenantA, leakedTenantB });
    process.exitCode = 1;
  }

  // Cleanup
  await adminDb.delete(schema.leads).where(eq(schema.leads.tenantId, tenantA.id));
  await adminDb.delete(schema.leads).where(eq(schema.leads.tenantId, tenantB.id));
  await adminDb.delete(schema.tenants).where(eq(schema.tenants.id, tenantA.id));
  await adminDb.delete(schema.tenants).where(eq(schema.tenants.id, tenantB.id));

  await adminClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
