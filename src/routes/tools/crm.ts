import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withStore } from "../../store";

export const crmRouter = Router();

crmRouter.post("/tools/crm/update", verifyHmac(config.vapiToolSecret), (req, res) => {
  const { session_id, contact_id, action, fields, activity } = req.body || {};
  if (!session_id || !action) {
    return res.status(400).json({ error: "session_id and action are required" });
  }

  const id = contact_id || `lead_${session_id}`;

  const lead = withStore((store) => {
    const existing = store.leads[id] || { id, created_at: new Date().toISOString(), activities: [] };
    const updated = {
      ...existing,
      ...(fields || {}),
      id,
      updated_at: new Date().toISOString(),
    };
    if (activity) {
      updated.activities = [...(existing.activities || []), { ...activity, at: new Date().toISOString() }];
    }
    store.leads[id] = updated;
    return updated;
  });

  console.log(`[crm.update] action=${action} contact_id=${id} session=${session_id}`);

  res.status(200).json({ updated: true, contact_id: id, mock: config.mockMode });
});
