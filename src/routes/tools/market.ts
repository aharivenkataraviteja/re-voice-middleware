import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { extractToolCall, sendToolResult, sendToolError } from "../../lib/vapiTool";

export const marketRouter = Router();

// Safe fallback only — never fabricates market stats. Matches the
// hallucination-prevention rules in compliance_rules.json.
marketRouter.post("/tools/market/snapshot", verifyHmac(config.vapiToolSecret), (req, res) => {
  const { toolCallId, args } = extractToolCall(req);
  const { location } = args;
  if (!location) {
    return sendToolError(res, toolCallId, "location is required");
  }

  sendToolResult(res, toolCallId, {
    location,
    available: false,
    reason: "no live market-data feed configured",
    safe_fallback: true,
    mock: config.mockMode,
  });
});
