import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withStore } from "../../store";

export const transferRouter = Router();

transferRouter.post("/tools/call/transfer", verifyHmac(config.vapiToolSecret), (req, res) => {
  const { transfer_type, target, escalation_reason, context_summary, session_id } = req.body || {};
  if (!transfer_type || !target || !escalation_reason || !session_id) {
    return res
      .status(400)
      .json({ error: "transfer_type, target, escalation_reason, and session_id are required" });
  }

  // No live human-agent routing configured yet — creates a callback task
  // instead of an actual transfer. Matches Step 6 mock behavior.
  const task = withStore((store) => {
    const record = {
      id: `xfer_${Date.now()}`,
      transfer_type,
      target,
      escalation_reason,
      context_summary: context_summary || null,
      session_id,
      status: "callback_task_created",
      created_at: new Date().toISOString(),
    };
    store.transfers.push(record);
    return record;
  });

  console.log(`[call.transfer] target=${target} reason="${escalation_reason}" task=${task.id}`);

  res.status(200).json({
    transferred: false,
    callback_task_created: true,
    task_id: task.id,
    mock: config.mockMode,
  });
});
