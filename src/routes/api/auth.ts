import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, withTenant } from "../../db/client";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../services/authService";
import { config } from "../../config";
import { requireAuth } from "../../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const REFRESH_COOKIE_NAME = "revoice_refresh";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.nodeEnv === "production",
  sameSite: "strict" as const,
  path: "/api/v1/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

interface AuthLookupRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
  role: "admin" | "manager" | "agent";
}

authRouter.post("/api/v1/auth/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", code: "BAD_REQUEST" });
    }
    const { email, password } = parsed.data;

    // SECURITY DEFINER function — the one deliberate, narrow exception to
    // tenant-scoped RLS reads, since tenant_id isn't known until this lookup
    // resolves it. See migrations/0004_auth_lookup_function.sql.
    const rows = (
      await db.execute(sql`select * from auth_lookup_user_by_email(${email})`)
    ) as unknown as AuthLookupRow[];
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: "invalid_credentials", code: "INVALID_CREDENTIALS" });
    }

    const passwordOk = await verifyPassword(password, user.password_hash);
    if (!passwordOk) {
      return res.status(401).json({ error: "invalid_credentials", code: "INVALID_CREDENTIALS" });
    }

    const accessToken = signAccessToken({ sub: user.id, tenantId: user.tenant_id, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, tenantId: user.tenant_id });

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);
    res.status(200).json({ accessToken, role: user.role });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/api/v1/auth/refresh", async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "missing_refresh_token", code: "AUTH_REQUIRED" });
  }
  try {
    const claims = verifyRefreshToken(token);
    // Re-fetch role fresh rather than trusting a stale claim if it were
    // embedded in the refresh token — role changes should take effect
    // without waiting for a 7-day-old refresh token to expire. Must run
    // through withTenant (tenantId is already known from the refresh token
    // claims) — querying the bare `db` skips RLS's tenant scoping entirely
    // and silently returns zero rows.
    const role = await withTenant(claims.tenantId, async (tx) => {
      const rows = await tx.execute(sql`select role from users where id = ${claims.sub}`);
      return (rows as unknown as Array<{ role: "admin" | "manager" | "agent" }>)[0]?.role;
    });
    if (!role) {
      return res.status(401).json({ error: "user_not_found", code: "AUTH_REQUIRED" });
    }
    const accessToken = signAccessToken({ sub: claims.sub, tenantId: claims.tenantId, role });
    res.status(200).json({ accessToken, role });
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_refresh_token", code: "AUTH_REQUIRED" });
  }
});

authRouter.get("/api/v1/auth/me", requireAuth, (req, res) => {
  res.status(200).json({ userId: req.user!.sub, tenantId: req.user!.tenantId, role: req.user!.role });
});

authRouter.post("/api/v1/auth/logout", (_req, res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/v1/auth" });
  res.status(200).json({ loggedOut: true });
});

// Exported for the M1 seed script only — not mounted as a route.
export { hashPassword };
