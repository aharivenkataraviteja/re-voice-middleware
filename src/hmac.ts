import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * VAPI's real webhook/tool-call authentication was confirmed (via a live
 * failed test call) to NOT match the HMAC-signature scheme originally
 * assumed here. VAPI's documented mechanism sends the configured secret
 * directly in an `x-vapi-secret` header for a direct compare. That is tried
 * first; the original HMAC-signature scheme is kept as a fallback in case a
 * different call path uses it. If neither header is present, the set of
 * incoming header names (never values) is logged to help diagnose further.
 */
export function verifyHmac(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Diagnostic only — header NAMES (never values), so a real request's
    // actual auth method is provable from production logs instead of
    // assumed from a comment or the VAPI dashboard's "Credential" setting,
    // which is a separate concept from the tool-level server.secret this
    // middleware actually checks.
    const headerNames = Object.keys(req.headers).join(", ");

    const directSecret = req.header("x-vapi-secret");
    if (directSecret) {
      if (timingSafeStringEqual(directSecret, secret)) {
        console.log(`[hmac] AUTH_OK method=x-vapi-secret path=${req.path} headers=[${headerNames}]`);
        return next();
      }
      console.log(`[hmac] AUTH_FAIL method=x-vapi-secret path=${req.path} headers=[${headerNames}]`);
      return res.status(401).json({ error: "invalid secret" });
    }

    const sigHeader = req.header("x-vapi-signature");
    const rawBody: Buffer | undefined = (req as any).rawBody;
    if (sigHeader && rawBody) {
      const provided = sigHeader.startsWith("sha256=") ? sigHeader.slice(7) : sigHeader;
      const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      const providedBuf = Buffer.from(provided, "hex");
      const expectedBuf = Buffer.from(expected, "hex");
      if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
        console.log(`[hmac] AUTH_OK method=x-vapi-signature path=${req.path} headers=[${headerNames}]`);
        return next();
      }
      console.log(`[hmac] AUTH_FAIL method=x-vapi-signature path=${req.path} headers=[${headerNames}]`);
      return res.status(401).json({ error: "invalid signature" });
    }

    console.error(`[hmac] AUTH_MISSING path=${req.path} headers=[${headerNames}]`);
    return res.status(401).json({ error: "missing signature or secret" });
  };
}
