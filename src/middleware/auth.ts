import { Request, Response, NextFunction } from "express";
import { verifyAccessToken, AccessTokenClaims } from "../services/authService";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenClaims;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token", code: "AUTH_REQUIRED" });
  }

  const token = header.slice(7);
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token", code: "AUTH_REQUIRED" });
  }
}

export function requireRole(...allowed: Array<"admin" | "manager" | "agent">) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "missing_token", code: "AUTH_REQUIRED" });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "insufficient_role", code: "FORBIDDEN" });
    }
    next();
  };
}
