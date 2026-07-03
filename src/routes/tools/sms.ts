import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withStore } from "../../store";
import { redactPhone } from "../../lib/redact";

export const smsRouter = Router();

const TWILIO_CONFIGURED = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

smsRouter.post("/tools/sms/send", verifyHmac(config.vapiToolSecret), (req, res) => {
  const { to, template_id, session_id } = req.body || {};
  if (!to || !template_id || !session_id) {
    return res.status(400).json({ error: "to, template_id, and session_id are required" });
  }

  const sent = TWILIO_CONFIGURED && !config.mockMode;

  const record = withStore((store) => {
    const entry = {
      id: `sms_${Date.now()}`,
      to_redacted: redactPhone(to),
      template_id,
      session_id,
      sent,
      created_at: new Date().toISOString(),
    };
    store.smsLog.push(entry);
    return entry;
  });

  console.log(
    `[sms.send] ${sent ? "sent" : "logged (mock/no Twilio)"} to=${redactPhone(to)} template=${template_id}`
  );

  res.status(200).json({ queued: true, sent, sms_id: record.id, mock: !sent });
});
