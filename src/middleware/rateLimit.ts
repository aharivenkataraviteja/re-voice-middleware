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

function isProtectedPath(path: string): boolean {
  return path === "/vapi/webhook" || path.startsWith("/tools/");
}

// Routes to the stricter 30/min limiter for the webhook + tool endpoints,
// and the 100/min default limiter for everything else (e.g. /health).
export function rateLimiter(req: Request, res: Response, next: NextFunction) {
  if (isProtectedPath(req.path)) {
    return protectedLimiter(req, res, next);
  }
  return globalLimiter(req, res, next);
}
