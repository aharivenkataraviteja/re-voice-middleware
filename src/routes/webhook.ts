import { Router } from "express";
import { eq } from "drizzle-orm";
import { verifyHmac } from "../hmac";
import { config } from "../config";
import { withTenant } from "../db/client";
import * as schema from "../db/schema";

export const webhookRouter = Router();

webhookRouter.post("/vapi/webhook", verifyHmac(config.vapiWebhookSecret), async (req, res) => {
  const event = req.body;
  const message = event?.message || {};
  const type = message.type || event?.type || "unknown";
  const callId = message.call?.id || event?.call?.id || "unknown";

  console.log(`[webhook] event=${type} call_id=${callId}`);

  try {
    if (callId !== "unknown") {
      await withTenant(config.tenantId, async (tx) => {
        const [existing] = await tx.select().from(schema.calls).where(eq(schema.calls.vapiCallId, callId));

        if (type === "end-of-call-report") {
          const durationSeconds =
            message.durationSeconds ??
            (message.startedAt && message.endedAt
              ? Math.round((new Date(message.endedAt).getTime() - new Date(message.startedAt).getTime()) / 1000)
              : null);

          const patch = {
            durationSeconds: durationSeconds ?? undefined,
            outcome: message.endedReason ?? undefined,
            recordingUrl: message.recordingUrl ?? message.artifact?.recordingUrl ?? undefined,
            stereoRecordingUrl: message.stereoRecordingUrl ?? message.artifact?.stereoRecordingUrl ?? undefined,
            transcriptText: message.transcript ?? message.artifact?.transcript ?? undefined,
            summaryText: message.summary ?? message.analysis?.summary ?? undefined,
            structuredData: message.analysis?.structuredData ?? undefined,
            endedAt: new Date(),
          };

          if (existing) {
            await tx.update(schema.calls).set(patch).where(eq(schema.calls.id, existing.id));
          } else {
            await tx.insert(schema.calls).values({ tenantId: config.tenantId, vapiCallId: callId, ...patch });
          }
        } else if (!existing) {
          // First event seen for this call (e.g. assistant.started) — open
          // the calls row so later tool calls in this same session have
          // something to link a lead to.
          await tx.insert(schema.calls).values({ tenantId: config.tenantId, vapiCallId: callId, startedAt: new Date() });
        }
      });
    }
  } catch (err) {
    // A webhook write failure must never break the live call — log and
    // still acknowledge receipt. Matches circuit_breakers.json's global
    // degradation rule: a call is never terminated by a dependency failure.
    console.error(`[webhook] failed to persist event=${type} call_id=${callId}`, err);
  }

  res.status(200).json({ received: true });
});
