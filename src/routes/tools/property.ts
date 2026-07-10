import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { extractToolCall, sendToolResult, sendToolError } from "../../lib/vapiTool";

export const propertyRouter = Router();

// Safe fallback only — never fabricates an AVM/value. Matches the
// hallucination-prevention rules in compliance_rules.json.
propertyRouter.post("/tools/property/lookup", verifyHmac(config.vapiToolSecret), (req, res) => {
  const { toolCallId, args } = extractToolCall(req);
  const { address } = args;
  if (!address) {
    return sendToolError(res, toolCallId, "address is required");
  }

  sendToolResult(res, toolCallId, {
    address,
    available: false,
    reason: "no live MLS/public-records integration configured",
    safe_fallback: true,
    mock: config.mockMode,
  });
});
