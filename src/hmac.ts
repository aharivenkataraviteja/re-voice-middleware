import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * NOTE: This implements a standard HMAC-SHA256 signature check over the raw
 * request body, expecting a `x-vapi-signature: sha256=<hex>` header. VAPI's
 * actual webhook/tool-call authentication mechanism (header name and whether
 * it's a raw shared-secret compare vs a computed signature) has NOT yet been
 * verified against live VAPI docs for this account. Confirm and adjust before
 * Step 9/10 (wiring this to the real VAPI assistant).
 */
export function verifyHmac(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("x-vapi-signature");
    const rawBody: Buffer | undefined = (req as any).rawBody;

    if (!header || !rawBody) {
      return res.status(401).json({ error: "missing signature or body" });
    }

    const provided = header.startsWith("sha256=") ? header.slice(7) : header;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

    const providedBuf = Buffer.from(provided, "hex");
    const expectedBuf = Buffer.from(expected, "hex");

    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return res.status(401).json({ error: "invalid signature" });
    }

    next();
  };
}
