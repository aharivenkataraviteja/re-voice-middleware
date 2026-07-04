import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "./schema";
import { config } from "../config";
import { hashPassword } from "../services/authService";

// Seeds the one real Release 1.0 tenant. Uses the superuser connection
// deliberately — creating the first tenant/user is the one legitimate
// cross-tenant-context operation, same category as the auth lookup function.
async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: seed.ts <admin-email> <admin-password>");
    process.exit(1);
  }

  const client = postgres(config.databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  let [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.subdomain, "luxury-partners-realty"));

  if (!tenant) {
    [tenant] = await db
      .insert(schema.tenants)
      .values({
        brokerageName: "Luxury Partners Realty",
        subdomain: "luxury-partners-realty",
        primaryContactEmail: email,
        planTier: "starter",
      })
      .returning();
    console.log("Created tenant:", tenant.id);
  } else {
    console.log("Tenant already exists:", tenant.id);
  }

  const [existingUser] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (existingUser) {
    console.log("User already exists for this email, skipping.");
  } else {
    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(schema.users)
      .values({ tenantId: tenant.id, email, passwordHash, role: "admin", fullName: "Admin" })
      .returning();
    console.log("Created admin user:", user.id, user.email);
  }

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
