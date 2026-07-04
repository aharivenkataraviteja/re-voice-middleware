import { Router } from "express";
import { eq } from "drizzle-orm";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";

export const callsRouter = Router();

function isPrivileged(role: string) {
  return role === "admin" || role === "manager";
}

async function loadCallScoped(tenantId: string, callId: string, userId: string, role: string) {
  return withTenant(tenantId, async (tx) => {
    const [call] = await tx.select().from(schema.calls).where(eq(schema.calls.id, callId));
    if (!call) return null;
    if (!isPrivileged(role) && call.leadId) {
      const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, call.leadId));
      if (lead && lead.assignedAgentId !== userId) return "forbidden" as const;
    }
    return call;
  });
}

callsRouter.get("/api/v1/calls/:id", requireAuth, async (req, res, next) => {
  try {
    const result = await loadCallScoped(req.user!.tenantId, req.params.id, req.user!.sub, req.user!.role);
    if (result === null) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
    if (result === "forbidden") return res.status(403).json({ error: "forbidden", code: "FORBIDDEN" });
    res.status(200).json({ call: result });
  } catch (err) {
    next(err);
  }
});

// VAPI's recordingUrl is already a directly-fetchable URL (not proxied
// through our own storage — see System Architecture: no new object storage
// in Release 1.0). This just resolves it after the same access check as
// the call detail endpoint, rather than exposing recordings unauthenticated.
callsRouter.get("/api/v1/calls/:id/recording", requireAuth, async (req, res, next) => {
  try {
    const result = await loadCallScoped(req.user!.tenantId, req.params.id, req.user!.sub, req.user!.role);
    if (result === null) return res.status(404).json({ error: "not_found", code: "NOT_FOUND" });
    if (result === "forbidden") return res.status(403).json({ error: "forbidden", code: "FORBIDDEN" });
    if (!result.recordingUrl) {
      return res.status(404).json({ error: "no_recording_available", code: "NOT_FOUND" });
    }
    res.status(200).json({ recordingUrl: result.recordingUrl, stereoRecordingUrl: result.stereoRecordingUrl });
  } catch (err) {
    next(err);
  }
});
