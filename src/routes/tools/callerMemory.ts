import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import { findReturningCallerContext } from "../../services/callerMemoryService";
import { extractToolCall, sendToolResult, sendToolError } from "../../lib/vapiTool";

export const callerMemoryRouter = Router();

// Called by Alex at the very start of a call (see vapi_system_prompt.md,
// S00_CALLER_LOOKUP) using the caller's own number via VAPI's {{customer.number}}
// dynamic variable. Not verified against a live call yet — if that variable
// doesn't resolve for this VAPI account/plan, Alex simply never calls this and
// proceeds as a first-time caller, which is a safe, silent fallback either way.
callerMemoryRouter.post(
  "/tools/caller/lookup_history",
  verifyHmac(config.vapiToolSecret),
  async (req, res, next) => {
    const { toolCallId, args } = extractToolCall(req);
    const { phone, session_id } = args;
    if (!phone || !session_id) {
      return sendToolError(res, toolCallId, "phone and session_id are required");
    }

    try {
      const result = await withTenant(config.tenantId, (tx) => findReturningCallerContext(tx, phone));
      sendToolResult(res, toolCallId, result);
    } catch (err) {
      next(err);
    }
  }
);
