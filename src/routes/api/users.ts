import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";

export const usersRouter = Router();

// Every authenticated role can list tenant users — this is deliberately
// permissive (agents need it to see whose name is on a shared appointment or
// leaderboard row, not just admins), but only id/name/role/email are
// exposed, never passwordHash.
usersRouter.get("/api/v1/users", requireAuth, async (req, res, next) => {
  try {
    const users = await withTenant(req.user!.tenantId, async (tx) => {
      return tx
        .select({
          id: schema.users.id,
          fullName: schema.users.fullName,
          email: schema.users.email,
          role: schema.users.role,
        })
        .from(schema.users);
    });
    res.status(200).json({ users });
  } catch (err) {
    next(err);
  }
});
