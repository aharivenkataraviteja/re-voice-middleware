import { Router } from "express";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { paginationSchema } from "../../lib/pagination";

export const tasksRouter = Router();

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

const listTasksQuerySchema = paginationSchema.extend({
  assigneeId: z.string().uuid().optional(),
  status: z.enum(["open", "done", "snoozed"]).optional(),
  leadId: z.string().uuid().optional(),
});

tasksRouter.get("/api/v1/tasks", requireAuth, async (req, res, next) => {
  try {
    const parsed = listTasksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query", code: "BAD_REQUEST" });
    }
    const { assigneeId, status, leadId, limit, offset } = parsed.data;
    const privileged = isPrivileged(req.user!.role);

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const conditions = [] as any[];
      // Non-privileged users are always scoped to their own tasks — leadId,
      // if also present, narrows further within that scope, it never
      // widens it.
      if (!privileged) {
        conditions.push(eq(schema.tasks.assigneeId, req.user!.sub));
      } else if (assigneeId) {
        conditions.push(eq(schema.tasks.assigneeId, assigneeId));
      }
      if (status) conditions.push(eq(schema.tasks.status, status));
      if (leadId) conditions.push(eq(schema.tasks.leadId, leadId));
      const whereClause = conditions.length ? and(...conditions) : undefined;

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.tasks)
        .where(whereClause);

      const tasks = await tx
        .select()
        .from(schema.tasks)
        .where(whereClause)
        .orderBy(schema.tasks.dueDate)
        .limit(limit)
        .offset(offset);

      return { tasks, count };
    });

    res.status(200).json({
      tasks: result.tasks,
      total: result.count,
      hasMore: offset + result.tasks.length < result.count,
    });
  } catch (err) {
    next(err);
  }
});

const patchTaskSchema = z.object({
  status: z.enum(["open", "done", "snoozed"]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().optional(),
});

tasksRouter.patch("/api/v1/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const parsed = patchTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", code: "BAD_REQUEST" });
    }

    const result = await withTenant(req.user!.tenantId, async (tx) => {
      const [existing] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, req.params.id));
      if (!existing) return null;
      if (!isPrivileged(req.user!.role) && existing.assigneeId !== req.user!.sub) {
        return "forbidden" as const;
      }
      const patch: Record<string, unknown> = { ...parsed.data };
      if (parsed.data.dueDate !== undefined) {
        patch.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
      }
      const [updated] = await tx
        .update(schema.tasks)
        .set(patch)
        .where(eq(schema.tasks.id, req.params.id))
        .returning();
      return updated;
    });

    if (result === null) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
    if (result === "forbidden") return res.status(403).json({ error: "forbidden", code: "FORBIDDEN" });
    res.status(200).json({ task: result });
  } catch (err) {
    next(err);
  }
});
