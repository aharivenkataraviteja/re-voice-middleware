import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { computeWeeklyMetrics, narrateMetrics } from "../../services/coachService";

export const analyticsRouter = Router();

// requireAuth/requireRole are applied per-route, not via router.use() — a
// path-less router.use() previously caused a real bug where this router's
// blanket role gate intercepted requests meant for routers mounted after it
// (e.g. an agent's request to /api/v1/users was wrongly rejected here
// before ever reaching usersRouter). Brokerage-wide analytics are
// admin/manager only — an agent doesn't see other agents' numbers or
// brokerage-wide $ figures, matching the frozen Switchboard V2 design.

function startOfWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

analyticsRouter.get("/api/v1/analytics/summary", requireAuth, requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const summary = await withTenant(req.user!.tenantId, async (tx) => {
      const totalCalls = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.calls);
      const totalAppointments = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.appointments);
      const stageBreakdown = await tx
        .select({ stage: schema.leads.stage, count: sql<number>`count(*)::int` })
        .from(schema.leads)
        .groupBy(schema.leads.stage);
      const objectionBreakdown = await tx
        .select({ objectionType: schema.calls.objectionType, count: sql<number>`count(*)::int` })
        .from(schema.calls)
        .where(sql`${schema.calls.objectionType} is not null`)
        .groupBy(schema.calls.objectionType);
      const avgDuration = await tx
        .select({ avg: sql<number>`avg(${schema.calls.durationSeconds})` })
        .from(schema.calls)
        .where(sql`${schema.calls.durationSeconds} is not null`);

      return {
        totalCalls: totalCalls[0]?.count ?? 0,
        totalAppointments: totalAppointments[0]?.count ?? 0,
        leadsByStage: Object.fromEntries(stageBreakdown.map((r) => [r.stage, r.count])),
        objectionsByType: Object.fromEntries(objectionBreakdown.map((r) => [r.objectionType, r.count])),
        avgCallDurationSeconds: avgDuration[0]?.avg ? Math.round(Number(avgDuration[0].avg)) : null,
      };
    });
    res.status(200).json({ summary });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/api/v1/analytics/leaderboard", requireAuth, requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const rows = await withTenant(req.user!.tenantId, async (tx) => {
      return tx
        .select({
          agentId: schema.appointments.agentId,
          appointmentCount: sql<number>`count(*)::int`,
        })
        .from(schema.appointments)
        .where(sql`${schema.appointments.agentId} is not null`)
        .groupBy(schema.appointments.agentId)
        .orderBy(desc(sql`count(*)`));
    });
    res.status(200).json({ leaderboard: rows });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.get("/api/v1/analytics/coach-note", requireAuth, requireRole("admin", "manager"), async (req, res, next) => {
  try {
    const note = await withTenant(req.user!.tenantId, async (tx) => {
      const [latest] = await tx
        .select()
        .from(schema.coachNotes)
        .orderBy(desc(schema.coachNotes.weekStart))
        .limit(1);
      return latest ?? null;
    });
    res.status(200).json({ note });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.post("/api/v1/analytics/coach-note/generate", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const weekStart = startOfWeek();
    const note = await withTenant(req.user!.tenantId, async (tx) => {
      const metrics = await computeWeeklyMetrics(tx, req.user!.tenantId, weekStart);
      const { content, generatedBy } = narrateMetrics(metrics);
      const [created] = await tx
        .insert(schema.coachNotes)
        .values({
          tenantId: req.user!.tenantId,
          weekStart,
          content,
          metrics: metrics as any,
          generatedBy,
          approved: false,
        })
        .returning();
      return created;
    });
    res.status(201).json({ note });
  } catch (err) {
    next(err);
  }
});

analyticsRouter.patch(
  "/api/v1/analytics/coach-note/:id/approve",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const note = await withTenant(req.user!.tenantId, async (tx) => {
        const [updated] = await tx
          .update(schema.coachNotes)
          .set({ approved: true })
          .where(eq(schema.coachNotes.id, req.params.id))
          .returning();
        return updated ?? null;
      });
      if (!note) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
      res.status(200).json({ note });
    } catch (err) {
      next(err);
    }
  }
);
