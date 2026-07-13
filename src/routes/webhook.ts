import { Router } from "express";
import { verifyHmac } from "../hmac";
import { config } from "../config";
import { withTenant } from "../db/client";
import * as schema from "../db/schema";

export const webhookRouter = Router();

// VAPI fires dozens of webhook events per call (speech-update on nearly
// every turn, conversation-update, status-update, etc.) — a single ~5min
// call can produce 100+ near-simultaneous requests. A SELECT-then-INSERT
// pattern races under that volume: two requests can both see "no existing
// row" before either commits, and the loser throws a unique-constraint
// error on vapi_call_id. ON CONFLICT makes row creation atomic at the
// database level regardless of how many events arrive concurrently.
function extractTranscript(message: any): string | undefined {
  if (typeof message.transcript === "string" && message.transcript.length > 0) {
    return message.transcript;
  }
  if (typeof message.artifact?.transcript === "string" && message.artifact.transcript.length > 0) {
    return message.artifact.transcript;
  }
  // Observed VAPI shape for a real call: artifact.messages is an array of
  // { role, message } turns with no top-level "transcript" string at all.
  // Reconstruct one so transcript_text is never silently left null.
  const turns = message.artifact?.messages;
  if (Array.isArray(turns) && turns.length > 0) {
    const lines = turns
      .map((t: any) => {
        const text = t?.message ?? t?.content;
        return t?.role && text ? `${t.role}: ${text}` : null;
      })
      .filter((line: string | null): line is string => Boolean(line));
    if (lines.length > 0) return lines.join("\n");
  }
  return undefined;
}

webhookRouter.post("/vapi/webhook", verifyHmac(config.vapiWebhookSecret), async (req, res) => {
  const event = req.body;
  const message = event?.message || {};
  const type = message.type || event?.type || "unknown";
  const callId = message.call?.id || event?.call?.id || "unknown";

  console.log(`[webhook] event=${type} call_id=${callId}`);

  try {
    if (callId !== "unknown") {
      await withTenant(config.tenantId, async (tx) => {
        if (type === "end-of-call-report") {
          const durationSeconds =
            message.durationSeconds ??
            (message.startedAt && message.endedAt
              ? Math.round((new Date(message.endedAt).getTime() - new Date(message.startedAt).getTime()) / 1000)
              : null);

          const patch = {
            durationSeconds: durationSeconds != null ? Math.round(durationSeconds) : null,
            outcome: message.endedReason ?? null,
            endedReason: message.endedReason ?? null,
            recordingUrl: message.recordingUrl ?? message.artifact?.recordingUrl ?? null,
            stereoRecordingUrl: message.stereoRecordingUrl ?? message.artifact?.stereoRecordingUrl ?? null,
            transcriptText: extractTranscript(message) ?? null,
            summaryText: message.summary ?? message.analysis?.summary ?? null,
            structuredData: message.analysis?.structuredData ?? null,
            endedAt: new Date(),
          };

          // Atomic upsert: handles both the common case (row already exists
          // from an earlier event) and the rare case where end-of-call-report
          // is the first event this service ever sees for this call_id.
          await tx
            .insert(schema.calls)
            .values({ tenantId: config.tenantId, vapiCallId: callId, ...patch })
            .onConflictDoUpdate({ target: schema.calls.vapiCallId, set: patch });
        } else {
          // Any other event just needs to guarantee a row exists so later
          // tool calls in this session (e.g. send_sms, book_appointment) have
          // something to link a lead to. DO NOTHING on conflict — whichever
          // concurrent request got there first already created it.
          await tx
            .insert(schema.calls)
            .values({ tenantId: config.tenantId, vapiCallId: callId, startedAt: new Date() })
            .onConflictDoNothing({ target: schema.calls.vapiCallId });
        }
      });
    }
  } catch (err) {
    // A webhook write failure must never break the live call, and must never
    // cause VAPI to see anything but a 200 either — log and still acknowledge
    // receipt. Matches circuit_breakers.json's global degradation rule: a
    // call is never terminated by a dependency failure.
    console.error(`[webhook] failed to persist event=${type} call_id=${callId}`, err);
  }

  res.status(200).json({ received: true });
});
