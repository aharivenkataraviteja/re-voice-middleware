import { Router } from "express";
import { z } from "zod";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { paginationSchema } from "../../lib/pagination";
import { getTenantAvailability, DEFAULT_AVAILABILITY } from "../../services/availabilityService";

export const appointmentsRouter = Router();

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

const listAppointmentsQuerySchema = paginationSchema.extend({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

appointmentsRouter.get("/api/v1/appointments", requireAuth, async (req, res, next) => {
  try {
    const parsed = listAppointmentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", code: "BAD_REQUEST" });
    }
    const { from, to, limit, offset } = parsed.data;

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const conditions = [] as any[];
      if (!isPrivileged(req.user!.role)) {
        conditions.push(eq(schema.appointments.agentId, req.user!.sub));
      }
      if (from) conditions.push(gte(schema.appointments.slotStart, new Date(from)));
      if (to) conditions.push(lte(schema.appointments.slotStart, new Date(to)));
      const whereClause = conditions.length ? and(...conditions) : undefined;

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.appointments)
        .where(whereClause);

      const appointments = await tx
        .select()
        .from(schema.appointments)
        .where(whereClause)
        .orderBy(schema.appointments.slotStart)
        .limit(limit)
        .offset(offset);

      return { appointments, count };
    });

    res.status(200).json({
      appointments: result.appointments,
      total: result.count,
      hasMore: offset + result.appointments.length < result.count,
    });
  } catch (err) {
    next(err);
  }
});

const patchAppointmentSchema = z.object({
  slotStart: z.string().datetime().optional(),
  status: z.enum(["confirmed", "completed", "no_show", "cancelled"]).optional(),
  notes: z.string().optional(),
});

appointmentsRouter.patch("/api/v1/appointments/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = patchAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", code: "BAD_REQUEST" });
    }

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, req.params.id));
      if (!existing) return null;
      if (!isPrivileged(req.user!.role) && existing.agentId !== req.user!.sub) {
        return "forbidden" as const;
      }
      const patch: Record<string, unknown> = { ...parsed.data };
      if (parsed.data.slotStart) patch.slotStart = new Date(parsed.data.slotStart);
      const [updated] = await tx
        .update(schema.appointments)
        .set(patch)
        .where(eq(schema.appointments.id, req.params.id))
        .returning();
      return updated;
    });

    if (result === null) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
    if (result === "forbidden") return res.status(403).json({ error: "forbidden", code: "FORBIDDEN" });
    res.status(200).json({ appointment: result });
  } catch (err) {
    next(err);
  }
});

const availabilitySchema = z.object({
  timezone: z.string().optional(),
  businessHours: z.object({ start: z.string(), end: z.string(), days: z.array(z.number().int().min(0).max(6)) }).optional(),
  bufferMinutes: z.number().int().min(0).optional(),
  maxPerDay: z.number().int().min(1).optional(),
});

// Tenant-wide business-hours config, shared with the real Google Calendar
// slot generation in routes/tools/calendar.ts via availabilityService.ts —
// one source of truth for "when is this brokerage open."
appointmentsRouter.get("/api/v1/availability", requireAuth, async (req, res, next) => {
  try {
    const availability = await withTenant(req.user!.tenantId, (tx) => getTenantAvailability(tx, req.user!.tenantId));
    res.status(200).json(availability);
  } catch (err) {
    next(err);
  }
});

appointmentsRouter.patch("/api/v1/availability", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", code: "BAD_REQUEST" });
    }
    const updated = await withTenant(req.user!.tenantId, async (tx) => {
      const [tenant] = await tx
        .select({ settings: schema.tenants.settings })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, req.user!.tenantId));
      const currentAvailability = (tenant?.settings as any)?.availability ?? DEFAULT_AVAILABILITY;
      const nextAvailability = { ...currentAvailability, ...parsed.data };
      const nextSettings = { ...(tenant?.settings as object | undefined), availability: nextAvailability };
      await tx
        .update(schema.tenants)
        .set({ settings: nextSettings })
        .where(eq(schema.tenants.id, req.user!.tenantId));
      return nextAvailability;
    });
    res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
});
