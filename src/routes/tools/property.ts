import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";

export const propertyRouter = Router();

// Safe fallback only — never fabricates an AVM/value. Matches the
// hallucination-prevention rules in compliance_rules.json.
propertyRouter.post("/tools/property/lookup", verifyHmac(config.vapiToolSecret), (req, res) => {
  const { address } = req.body || {};
  if (!address) {
    return res.status(400).json({ error: "address is required" });
  }

  res.status(200).json({
    address,
    available: false,
    reason: "no live MLS/public-records integration configured",
    safe_fallback: true,
    mock: config.mockMode,
  });
});
