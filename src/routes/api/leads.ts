import { Router } from "express";
import { z } from "zod";
import { eq, and, or, ilike, desc, sql } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { paginationSchema } from "../../lib/pagination";

export const leadsRouter = Router();

// requireAuth is applied per-route below, not via a blanket router.use() —
// a path-less router.use() runs for every request that reaches this router
// regardless of which route (if any) ultimately matches, which previously
// caused a real bug: a different router's blanket role-gate intercepted
// requests meant for routers mounted after it. Explicit per-route middleware
// can't leak across routers no matter the mount order.

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

const listLeadsQuerySchema = paginationSchema.extend({
  stage: z.enum(["hot", "warm", "cold", "past_client"]).optional(),
  assignedAgentId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

leadsRouter.get("/api/v1/leads", requireAuth, async (req, res, next) => {
  try {
    const parsed = listLeadsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", code: "BAD_REQUEST" });
    }
    const { stage, search, assignedAgentId, limit, offset } = parsed.data;
    const privileged = isPrivileged(req.user!.role);

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const conditions = [] as any[];
      if (stage) conditions.push(eq(schema.leads.stage, stage));
      if (!privileged) {
        conditions.push(eq(schema.leads.assignedAgentId, req.user!.sub));
      } else if (assignedAgentId) {
        conditions.push(eq(schema.leads.assignedAgentId, assignedAgentId));
      }
      if (search) {
        conditions.push(
          or(ilike(schema.leads.callerName, `%${search}%`), ilike(schema.leads.phone, `%${search}%`))
        );
      }
      const whereClause = conditions.length ? and(...conditions) : undefined;

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.leads)
        .where(whereClause);

      const leads = await tx
        .select()
        .from(schema.leads)
        .where(whereClause)
        .orderBy(desc(schema.leads.updatedAt))
        .limit(limit)
        .offset(offset);

      return { leads, count };
    });

    res.status(200).json({
      leads: result.leads,
      total: result.count,
      hasMore: offset + result.leads.length < result.count,
    });
  } catch (err) {
    next(err);
  }
});

leadsRouter.get("/api/v1/leads/:id", requireAuth, async (req, res, next) => {
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

leadsRouter.patch("/api/v1/leads/:id", requireAuth, async (req, res, next) => {
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

leadsRouter.post("/api/v1/leads", requireAuth, async (req, res, next) => {
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

leadsRouter.post("/api/v1/leads/:id/timeline", requireAuth, async (req, res, next) => {
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
