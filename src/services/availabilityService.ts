import { eq } from "drizzle-orm";
import * as schema from "../db/schema";
import type { TenantScopedDb } from "../db/client";

export interface TenantAvailability {
  timezone: string;
  businessHours: { start: string; end: string; days: number[] };
  bufferMinutes: number;
  maxPerDay: number;
}

export const DEFAULT_AVAILABILITY: TenantAvailability = {
  timezone: "America/New_York",
  // Luxury Partners Realty's real hours: 9:00 AM–5:30 PM, Monday–Friday
  // (days: 1=Mon..5=Fri, so weekends are already excluded here).
  businessHours: { start: "09:00", end: "17:30", days: [1, 2, 3, 4, 5] },
  bufferMinutes: 15,
  maxPerDay: 3,
};

// Single source of truth for "when is this brokerage open" — used by the
// dashboard's own /api/v1/availability endpoint and by the calendar tool's
// real-slot generation, so an admin changing business hours in one place
// actually changes both.
export async function getTenantAvailability(tx: TenantScopedDb, tenantId: string): Promise<TenantAvailability> {
  const [tenant] = await tx.select({ settings: schema.tenants.settings }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  const settings = tenant?.settings as { availability?: TenantAvailability } | undefined;
  return settings?.availability ?? DEFAULT_AVAILABILITY;
}
