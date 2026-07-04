import { Router } from "express";
import { z } from "zod";
import { eq, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";

export const appointmentsRouter = Router();

appointmentsRouter.use(requireAuth);

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

appointmentsRouter.get("/api/v1/appointments", async (req, res, next) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    const appointments = await withTenant(req.user!.tenantId, async (tx) => {
      const conditions = [] as any[];
      if (!isPrivileged(req.user!.role)) {
        conditions.push(eq(schema.appointments.agentId, req.user!.sub));
      }
      if (from) conditions.push(gte(schema.appointments.slotStart, new Date(from)));
      if (to) conditions.push(lte(schema.appointments.slotStart, new Date(to)));
      return tx
        .select()
        .from(schema.appointments)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(schema.appointments.slotStart);
    });
    res.status(200).json({ appointments });
  } catch (err) {
    next(err);
  }
});

const patchAppointmentSchema = z.object({
  slotStart: z.string().datetime().optional(),
  status: z.enum(["confirmed", "completed", "no_show", "cancelled"]).optional(),
  notes: z.string().optional(),
});

appointmentsRouter.patch("/api/v1/appointments/:id", async (req, res, next) => {
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

// Release 1.0: fixed business-hours availability, no per-agent calendar
// integration yet (that's backlog, module 4's Google/Outlook sync). This is
// enough for check_calendar_availability's mock slots and the Calendar
// screen's "set availability" placeholder.
appointmentsRouter.get("/api/v1/availability", async (req, res) => {
  res.status(200).json({
    timezone: "America/New_York",
    businessHours: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
    bufferMinutes: 15,
    maxPerDay: 3,
  });
});
