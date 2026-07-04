import { Router } from "express";
import { z } from "zod";
import { eq, and, or, ilike, desc } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";

export const leadsRouter = Router();

leadsRouter.use(requireAuth);

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

leadsRouter.get("/api/v1/leads", async (req, res, next) => {
  try {
    const { stage, search } = req.query as { stage?: string; search?: string };
    const leads = await withTenant(req.user!.tenantId, async (tx) => {
      const conditions = [] as any[];
      if (stage) conditions.push(eq(schema.leads.stage, stage as any));
      if (!isPrivileged(req.user!.role)) {
        conditions.push(eq(schema.leads.assignedAgentId, req.user!.sub));
      }
      if (search) {
        conditions.push(
          or(ilike(schema.leads.callerName, `%${search}%`), ilike(schema.leads.phone, `%${search}%`))
        );
      }
      return tx
        .select()
        .from(schema.leads)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(schema.leads.updatedAt));
    });
    res.status(200).json({ leads });
  } catch (err) {
    next(err);
  }
});

leadsRouter.get("/api/v1/leads/:id", async (req, res, next) => {
  try {
    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, req.params.id));
      if (!lead) return null;
      if (!isPrivileged(req.user!.role) && lead.assignedAgentId !== req.user!.sub) {
        return "forbidden" as const;
      }
      const timeline = await tx
        .select()
        .from(schema.timelineEvents)
        .where(eq(schema.timelineEvents.leadId, lead.id))
        .orderBy(schema.timelineEvents.eventDate);
      const calls = await tx
        .select()
        .from(schema.calls)
        .where(eq(schema.calls.leadId, lead.id))
        .orderBy(desc(schema.calls.startedAt));
      const appointments = await tx
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.leadId, lead.id));
      return { lead, timeline, calls, appointments };
    });

    if (result === null) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
    if (result === "forbidden") return res.status(403).json({ error: "forbidden", code: "FORBIDDEN" });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

const patchLeadSchema = z.object({
  stage: z.enum(["hot", "warm", "cold", "past_client"]).optional(),
  assignedAgentId: z.string().uuid().nullable().optional(),
  status: z.string().optional(),
  callerName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
});

leadsRouter.patch("/api/v1/leads/:id", async (req, res, next) => {
  try {
    const parsed = patchLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", code: "BAD_REQUEST" });
    }

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const [existing] = await tx.select().from(schema.leads).where(eq(schema.leads.id, req.params.id));
      if (!existing) return null;
      if (!isPrivileged(req.user!.role) && existing.assignedAgentId !== req.user!.sub) {
        return "forbidden" as const;
      }
      const [updated] = await tx
        .update(schema.leads)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(schema.leads.id, req.params.id))
        .returning();
      return updated;
    });

    if (result === null) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
    if (result === "forbidden") return res.status(403).json({ error: "forbidden", code: "FORBIDDEN" });
    res.status(200).json({ lead: result });
  } catch (err) {
    next(err);
  }
});

const createLeadSchema = z.object({
  callerName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  intent: z.string().optional(),
  assignedAgentId: z.string().uuid().optional(),
});

leadsRouter.post("/api/v1/leads", async (req, res, next) => {
  try {
    const parsed = createLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", code: "BAD_REQUEST" });
    }
    const lead = await withTenant(req.user!.tenantId, async (tx) => {
      const [created] = await tx
        .insert(schema.leads)
        .values({ tenantId: req.user!.tenantId, ...parsed.data })
        .returning();
      return created;
    });
    res.status(201).json({ lead });
  } catch (err) {
    next(err);
  }
});

const timelineEventSchema = z.object({
  eventType: z.enum(["called", "appointment_booked", "showing", "offer", "inspection", "closed"]),
  eventDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

leadsRouter.post("/api/v1/leads/:id/timeline", async (req, res, next) => {
  try {
    const parsed = timelineEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", code: "BAD_REQUEST" });
    }

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const [existing] = await tx.select().from(schema.leads).where(eq(schema.leads.id, req.params.id));
      if (!existing) return null;
      if (!isPrivileged(req.user!.role) && existing.assignedAgentId !== req.user!.sub) {
        return "forbidden" as const;
      }
      // Manual/agent-logged, matching the timeline's source column so the
      // frontend can distinguish this from what Alex logged automatically.
      const [event] = await tx
        .insert(schema.timelineEvents)
        .values({
          tenantId: req.user!.tenantId,
          leadId: req.params.id,
          eventType: parsed.data.eventType,
          eventDate: parsed.data.eventDate ? new Date(parsed.data.eventDate) : new Date(),
          notes: parsed.data.notes,
          source: "agent",
        })
        .returning();
      return event;
    });

    if (result === null) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
    if (result === "forbidden") return res.status(403).json({ error: "forbidden", code: "FORBIDDEN" });
    res.status(201).json({ event: result });
  } catch (err) {
    next(err);
  }
});
