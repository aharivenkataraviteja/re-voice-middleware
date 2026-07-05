import rateLimit from "express-rate-limit";
import { Request, Response, NextFunction } from "express";

const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "rate_limit_exceeded", scope: "global" });
  },
});

const protectedLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "rate_limit_exceeded", scope: "protected" });
  },
});

// /vapi/webhook is not a per-decision tool call like /tools/* — VAPI fires a
// webhook event on nearly every speech/conversation turn, and a single ~5min
// call was observed producing 164 of them. The 30/min tool-call limit was
// silently 429-ing a large fraction of those (including, non-deterministically,
// potentially the end-of-call-report itself), which looks identical to data
// going missing. Sized well above observed real-call volume with headroom
// for multiple concurrent calls; still bounded since the endpoint requires a
// valid secret regardless.
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "rate_limit_exceeded", scope: "webhook" });
  },
});

function isWebhookPath(path: string): boolean {
  return path === "/vapi/webhook";
}

function isProtectedPath(path: string): boolean {
  return path.startsWith("/tools/");
}

// Routes: the high-throughput limiter for the VAPI webhook, the stricter
// 30/min limiter for individual tool-call endpoints, and the 100/min default
// limiter for everything else (e.g. /health).
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  if (isWebhookPath(req.path)) {
    return webhookLimiter(req, res, next);
  }
  if (isProtectedPath(req.path)) {
    return protectedLimiter(req, res, next);
  }
  return globalLimiter(req, res, next);
}
