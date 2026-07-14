import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import { findReturningCallerContext } from "../../services/callerMemoryService";
import { findOrCreateLeadForSession } from "../../services/leadService";
import { getTenantAvailability } from "../../services/availabilityService";
import { computeDateContext } from "../../lib/dateContext";
import { extractToolCall, resolveCallId, sendToolResult, sendToolError } from "../../lib/vapiTool";

export const callerMemoryRouter = Router();

// Called by Alex at the very start of a call (see vapi_system_prompt.md,
// S00_CALLER_LOOKUP) using the caller's own number via VAPI's {{customer.number}}
// dynamic variable. `phone` falls back to the webhook envelope's authoritative
// message.customer.number when the LLM omits/mistypes the arg — the same
// "derive, don't trust" pattern as the call ID (see resolveCallId).
//
// Also the single place every call already reaches before the greeting, so
// it doubles as the delivery point for deterministic date/time context
// (date_context) — see dateContext.ts and vapi_system_prompt.md's DATE &
// TIME RESOLUTION section.
callerMemoryRouter.post(
  "/tools/caller/lookup_history",
  verifyHmac(config.vapiToolSecret),
  async (req, res, next) => {
    const { toolCallId, args, realCallId, callerNumber } = extractToolCall(req);
    const { phone: llmPhone, session_id: llmSessionId } = args;
    const phone = llmPhone || callerNumber;
    const callId = resolveCallId(realCallId, llmSessionId, "lookup_caller_history");

    if (!phone) {
      // No number available on this call at all (llmPhone unset and no
      // customer.number on the envelope) — proceed as a first-time caller
      // per S00_CALLER_LOOKUP rather than failing the call.
      return sendToolResult(res, toolCallId, { returning: false });
    }

    try {
      const result = await withTenant(config.tenantId, async (tx) => {
        const memory = await findReturningCallerContext(tx, phone);
        // Ensures a calls/lead row exists (and is deduped by phone) from the
        // very first tool call of the conversation, same as every other
        // tool — not just when a booking/CRM update happens later.
        await findOrCreateLeadForSession(tx, callId, phone);
        const availability = await getTenantAvailability(tx, config.tenantId);
        const dateContext = computeDateContext(new Date(), availability.timezone, availability.businessHours);
        return { ...memory, dateContext };
      });
      sendToolResult(res, toolCallId, result);
    } catch (err) {
      next(err);
    }
  }
);
