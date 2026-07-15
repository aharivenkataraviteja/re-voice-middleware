import { Router } from "express";
import { verifyHmac } from "../hmac";
import { config } from "../config";
import { withTenant } from "../db/client";
import { toE164 } from "../lib/phone";
import { computeDateContext } from "../lib/dateContext";
import { DEFAULT_AVAILABILITY } from "../services/availabilityService";
import { buildAssistantRequestContext } from "../services/callerMemoryService";

export const assistantRequestRouter = Router();

// Same assistant already registered on Vapi (see vapi_system_prompt.md's
// header comment) — this endpoint never changes WHICH assistant handles the
// call, only injects per-call variableValues into it before the first model
// turn. Single-tenant pilot: no lookup table needed for this ID.
const ASSISTANT_ID = "e97cb966-9cba-4449-908d-a6d9bbbcf5ef";

// Vapi's telephony provider enforces a hard 7.5s response deadline on
// assistant-request (docs.vapi.ai/server-url/events); Vapi's own guidance is
// to target well under that. The DB lookup is the only part of this handler
// that can be slow or fail, so it alone is timeout-guarded — date/time
// context is pure computation and always included regardless.
const LOOKUP_TIMEOUT_MS = 2500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lookup exceeded ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

assistantRequestRouter.post("/vapi/assistant-request", verifyHmac(config.vapiWebhookSecret), async (req, res) => {
  const start = Date.now();
  const message = req.body?.message;
  const call = message?.call;
  const rawNumber: string | undefined = call?.customer?.number || message?.customer?.number;
  const callId: string = call?.id || "unknown";

  console.log(`[assistant-request] received call=${callId}`);

  const e164 = rawNumber ? toE164(rawNumber) : null;
  console.log(
    `[assistant-request] caller_number_resolved call=${callId} number_present=${Boolean(rawNumber)} normalized=${Boolean(e164)}`
  );

  // Always-safe baseline: pure Intl computation, no DB, cannot fail or time
  // out. Uses the known tenant timezone/business hours directly (this is a
  // fixed single-tenant pilot constant, not a DB read) so it's available
  // even if the lookup below fails entirely.
  const dateContext = computeDateContext(new Date(), DEFAULT_AVAILABILITY.timezone, DEFAULT_AVAILABILITY.businessHours);

  const variableValues: Record<string, string> = {
    current_local_date: dateContext.localDate,
    current_local_time: dateContext.localTime,
    current_local_weekday: dateContext.localWeekday,
    current_timezone: dateContext.timezone,
    office_hours_open: String(dateContext.officeHoursOpen),
    caller_returning: "false",
    caller_name: "",
    caller_lead_type: "",
    caller_latest_appointment: "",
    caller_assigned_agent: "",
    caller_context: "",
  };

  if (e164) {
    try {
      const lookup = config.assistantRequestForceTimeout
        ? new Promise<never>((_, reject) => setTimeout(() => reject(new Error("forced_timeout_test")), LOOKUP_TIMEOUT_MS + 500))
        : withTenant(config.tenantId, (tx) => buildAssistantRequestContext(tx, e164));
      const enriched = await withTimeout(lookup, LOOKUP_TIMEOUT_MS);
      if (enriched) {
        console.log(`[assistant-request] lead_found call=${callId} lead=${enriched.leadId}`);
        variableValues.caller_returning = "true";
        variableValues.caller_name = enriched.callerName || "";
        variableValues.caller_lead_type = enriched.leadType || "";
        variableValues.caller_latest_appointment = enriched.latestAppointmentLabel || "";
        variableValues.caller_assigned_agent = enriched.assignedAgentName || "";
        variableValues.caller_context = enriched.context || "";
        console.log(`[assistant-request] context_injected call=${callId}`);
      } else {
        console.log(`[assistant-request] lead_not_found call=${callId}`);
      }
    } catch (err) {
      // Never let a lookup failure or timeout block the call from
      // connecting — respond with the safe baseline (date/time only, no
      // caller-specific fields) using the same assistant as always.
      console.warn(
        `[assistant-request] fallback_used call=${callId} reason=${err instanceof Error ? err.message : "unknown_error"}`
      );
    }
  }

  const latencyMs = Date.now() - start;
  console.log(`[assistant-request] responding call=${callId} latency_ms=${latencyMs}`);

  res.status(200).json({
    assistantId: ASSISTANT_ID,
    assistantOverrides: { variableValues },
  });
});
