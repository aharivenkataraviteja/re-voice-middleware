import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";

export const marketRouter = Router();

// Safe fallback only — never fabricates market stats. Matches the
// hallucination-prevention rules in compliance_rules.json.
marketRouter.post("/tools/market/snapshot", verifyHmac(config.vapiToolSecret), (req, res) => {
  const { location } = req.body || {};
  if (!location) {
    return res.status(400).json({ error: "location is required" });
  }

  res.status(200).json({
    location,
    available: false,
    reason: "no live market-data feed configured",
    safe_fallback: true,
    mock: config.mockMode,
  });
});
