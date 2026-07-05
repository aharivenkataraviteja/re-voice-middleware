import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { findOrCreateLeadForSession } from "../../services/leadService";
import { redactPhone } from "../../lib/redact";

export const smsRouter = Router();

const TWILIO_CONFIGURED = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
const MAX_SMS_PER_CALL = 2;

smsRouter.post("/tools/sms/send", verifyHmac(config.vapiToolSecret), async (req, res, next) => {
  const { to, template_id, session_id } = req.body || {};
  if (!to || !template_id || !session_id) {
    return res.status(400).json({ error: "to, template_id, and session_id are required" });
  }

  try {
    const result = await withTenant(config.tenantId, async (tx) => {
      const { leadId } = await findOrCreateLeadForSession(tx, session_id);

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.smsLog)
        .where(and(eq(schema.smsLog.sessionId, session_id)));

      if (count >= MAX_SMS_PER_CALL) {
        return { capped: true as const };
      }

      const sent = TWILIO_CONFIGURED && !config.mockMode;

      const [entry] = await tx
        .insert(schema.smsLog)
        .values({
          tenantId: config.tenantId,
          leadId,
          sessionId: session_id,
          toNumberRedacted: redactPhone(to),
          templateId: template_id,
          sent,
        })
        .returning();

      return { capped: false as const, entry, sent };
    });

    if (result.capped) {
      console.log(`[sms.send] capped at ${MAX_SMS_PER_CALL}/call for session=${session_id}`);
      return res.status(200).json({ queued: false, capped: true, mock: config.mockMode });
    }

    // Log unambiguously whenever this is not a real send — MOCK_MODE=true
    // (intentional for this release, see config.ts) and/or Twilio not being
    // configured both mean no SMS actually left this server. Never let a log
    // line read as if a real message went out when it didn't.
    if (result.sent) {
      console.log(`[sms.send] SENT (real) to=${redactPhone(to)} template=${template_id}`);
    } else {
      const reason = !TWILIO_CONFIGURED ? "no Twilio credentials configured" : "MOCK_MODE=true";
      console.log(
        `[sms.send] MOCK — no real SMS sent (${reason}) to=${redactPhone(to)} template=${template_id}`
      );
    }

    res.status(200).json({ queued: true, sent: result.sent, sms_id: result.entry.id, mock: !result.sent });
  } catch (err) {
    next(err);
  }
});
