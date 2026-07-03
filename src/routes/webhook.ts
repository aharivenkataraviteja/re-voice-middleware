import { Router } from "express";
import { verifyHmac } from "../hmac";
import { config } from "../config";
import { withStore } from "../store";

export const webhookRouter = Router();

webhookRouter.post("/vapi/webhook", verifyHmac(config.vapiWebhookSecret), (req, res) => {
  const event = req.body;
  const type = event?.message?.type || event?.type || "unknown";
  const callId = event?.message?.call?.id || event?.call?.id || "unknown";

  console.log(`[webhook] event=${type} call_id=${callId}`);

  withStore((store) => {
    store.sessions[callId] = {
      ...(store.sessions[callId] || {}),
      lastEventType: type,
      lastEventAt: new Date().toISOString(),
    };
  });

  res.status(200).json({ received: true });
});
