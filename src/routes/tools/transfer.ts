import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { findOrCreateLeadForSession } from "../../services/leadService";

export const transferRouter = Router();

transferRouter.post("/tools/call/transfer", verifyHmac(config.vapiToolSecret), async (req, res, next) => {
  const { transfer_type, target, escalation_reason, context_summary, session_id } = req.body || {};
  if (!transfer_type || !target || !escalation_reason || !session_id) {
    return res
      .status(400)
      .json({ error: "transfer_type, target, escalation_reason, and session_id are required" });
  }

  try {
    // No live human-agent routing configured yet — creates an urgent
    // callback task instead of an actual transfer, which is exactly what
    // Today's Work (M4) surfaces to an agent.
    const task = await withTenant(config.tenantId, async (tx) => {
      const { leadId } = await findOrCreateLeadForSession(tx, session_id);

      await tx.insert(schema.timelineEvents).values({
        tenantId: config.tenantId,
        leadId,
        eventType: "called",
        source: "ai",
        notes: [`Escalation (${transfer_type} to ${target}): ${escalation_reason}`, context_summary]
          .filter(Boolean)
          .join(" — "),
      });

      const [created] = await tx
        .insert(schema.tasks)
        .values({
          tenantId: config.tenantId,
          leadId,
          title: `Call back — escalated to ${target}: ${escalation_reason}`,
          source: "call",
          dueDate: new Date(),
          status: "open",
        })
        .returning();

      return created;
    });

    console.log(`[call.transfer] target=${target} reason="${escalation_reason}" task=${task.id}`);

    res.status(200).json({
      transferred: false,
      callback_task_created: true,
      task_id: task.id,
      mock: config.mockMode,
    });
  } catch (err) {
    next(err);
  }
});
