import { Router } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

tasksRouter.get("/api/v1/tasks", async (req, res, next) => {
  try {
    const { assigneeId, status } = req.query as { assigneeId?: string; status?: string };
    const tasks = await withTenant(req.user!.tenantId, async (tx) => {
      const conditions = [] as any[];
      if (!isPrivileged(req.user!.role)) {
        conditions.push(eq(schema.tasks.assigneeId, req.user!.sub));
      } else if (assigneeId) {
        conditions.push(eq(schema.tasks.assigneeId, assigneeId));
      }
      if (status) conditions.push(eq(schema.tasks.status, status as any));
      return tx
        .select()
        .from(schema.tasks)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(schema.tasks.dueDate);
    });
    res.status(200).json({ tasks });
  } catch (err) {
    next(err);
  }
});

const patchTaskSchema = z.object({
  status: z.enum(["open", "done", "snoozed"]).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  assigneeId: z.string().uuid().optional(),
});

tasksRouter.patch("/api/v1/tasks/:id", async (req, res, next) => {
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
