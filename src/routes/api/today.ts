import { Router } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";

export const todayRouter = Router();

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

// Brokerage-configurable eventually — hardcoded default for Release 1.0.
// These are estimates derived from extracted budget signals, never a
// guarantee of booked revenue — the frontend must always label them as such.
const ASSUMED_COMMISSION_RATE = 0.025;

todayRouter.get("/api/v1/today", requireAuth, async (req, res, next) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const now = new Date();
    const privileged = isPrivileged(req.user!.role);

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const scopeCondition = privileged
        ? undefined
        : eq(schema.tasks.assigneeId, req.user!.sub);

      const overdueTasks = await tx
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.status, "open"),
            lte(schema.tasks.dueDate, now),
            ...(scopeCondition ? [scopeCondition] : [])
          )
        );

      const apptScope = privileged ? undefined : eq(schema.appointments.agentId, req.user!.sub);
      const todaysAppointments = await tx
        .select()
        .from(schema.appointments)
        .where(
          and(
            gte(schema.appointments.slotStart, startOfDay),
            lte(schema.appointments.slotStart, endOfDay),
            ...(apptScope ? [apptScope] : [])
          )
        )
        .orderBy(schema.appointments.slotStart);

      const leadScope = privileged ? undefined : eq(schema.leads.assignedAgentId, req.user!.sub);
      const hotLeads = await tx
        .select()
        .from(schema.leads)
        .where(and(eq(schema.leads.stage, "hot"), ...(leadScope ? [leadScope] : [])));

      let dollarMetrics: { potentialCommissionPipelineUsd: number; estimatedTransactionVolumeUsd: number } | null = null;
      if (privileged) {
        const pipelineLeads = await tx
          .select({ budgetFloor: schema.leads.budgetFloor, budgetCeiling: schema.leads.budgetCeiling })
          .from(schema.leads)
          .where(sql`${schema.leads.stage} in ('hot', 'warm') and (${schema.leads.budgetFloor} is not null or ${schema.leads.budgetCeiling} is not null)`);

        let transactionVolume = 0;
        for (const l of pipelineLeads) {
          const floor = l.budgetFloor ? Number(l.budgetFloor) : null;
          const ceiling = l.budgetCeiling ? Number(l.budgetCeiling) : null;
          const midpoint = floor != null && ceiling != null ? (floor + ceiling) / 2 : floor ?? ceiling ?? 0;
          transactionVolume += midpoint;
        }
        dollarMetrics = {
          estimatedTransactionVolumeUsd: Math.round(transactionVolume),
          potentialCommissionPipelineUsd: Math.round(transactionVolume * ASSUMED_COMMISSION_RATE),
        };
      }

      return { overdueTasks, todaysAppointments, hotLeads, dollarMetrics };
    });

    res.status(200).json({
      overdueTasks: result.overdueTasks,
      todaysAppointments: result.todaysAppointments,
      hotLeads: result.hotLeads,
      // null for agents — these are deliberately brokerage-wide, admin/manager only.
      dollarMetrics: result.dollarMetrics,
      dollarMetricsAreEstimates: result.dollarMetrics ? true : undefined,
    });
  } catch (err) {
    next(err);
  }
});
