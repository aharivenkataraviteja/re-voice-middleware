import { Router } from "express";
import { eq } from "drizzle-orm";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { findOrCreateLeadForSession } from "../../services/leadService";

export const calendarRouter = Router();

calendarRouter.post(
  "/tools/calendar/availability",
  verifyHmac(config.vapiToolSecret),
  (req, res) => {
    if (config.mockMode) {
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      res.status(200).json({
        slots: [
          { start: new Date(now + day).toISOString(), format: "in-person" },
          { start: new Date(now + 2 * day).toISOString(), format: "virtual" },
        ],
        mock: true,
      });
      return;
    }
    res.status(501).json({ error: "live calendar integration not configured" });
  }
);

calendarRouter.post(
  "/tools/calendar/book",
  verifyHmac(config.vapiToolSecret),
  async (req, res, next) => {
    const { slot_start, appointment_type, format, attendee_name, attendee_phone, session_id, notes } =
      req.body || {};

    if (!slot_start || !appointment_type || !attendee_name || !attendee_phone || !session_id) {
      return res.status(400).json({ error: "missing required booking fields" });
    }

    try {
      const booking = await withTenant(config.tenantId, async (tx) => {
        const { leadId } = await findOrCreateLeadForSession(tx, session_id);

        await tx
          .update(schema.leads)
          .set({ callerName: attendee_name, phone: attendee_phone, updatedAt: new Date() })
          .where(eq(schema.leads.id, leadId));

        const [appointment] = await tx
          .insert(schema.appointments)
          .values({
            tenantId: config.tenantId,
            leadId,
            slotStart: new Date(slot_start),
            appointmentType: appointment_type,
            format: format || null,
            notes: notes || null,
            status: "confirmed",
          })
          .returning();

        await tx.insert(schema.timelineEvents).values({
          tenantId: config.tenantId,
          leadId,
          eventType: "appointment_booked",
          source: "ai",
          notes: `${appointment_type} at ${slot_start}`,
        });

        return appointment;
      });

      console.log(`[calendar.book] booking=${booking.id} session=${session_id}`);

      res.status(200).json({
        booked: true,
        booking_id: booking.id,
        slot_start,
        mock: config.mockMode,
      });
    } catch (err) {
      next(err);
    }
  }
);
