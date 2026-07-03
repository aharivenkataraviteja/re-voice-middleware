import { Request, Response, NextFunction } from "express";
import { redactBody } from "../lib/redact";

function isProtectedPath(path: string): boolean {
  return path === "/vapi/webhook" || path.startsWith("/tools/");
}

// Never logs a raw request body for the webhook/tool endpoints — only the
// redacted form. Non-protected routes (e.g. /health) log without a body.
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on("finish", () => {
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      ip: req.ip,
    };

    if (isProtectedPath(req.path) && req.method !== "GET" && req.body) {
      entry.body = redactBody(req.body);
    }

    console.log(JSON.stringify(entry));
  });

  next();
}
