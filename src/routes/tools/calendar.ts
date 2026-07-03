import { Router } from "express";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withStore } from "../../store";

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
  (req, res) => {
    const { slot_start, appointment_type, attendee_name, attendee_phone, session_id, notes } =
      req.body || {};

    if (!slot_start || !appointment_type || !attendee_name || !attendee_phone || !session_id) {
      return res.status(400).json({ error: "missing required booking fields" });
    }

    const booking = withStore((store) => {
      const record = {
        id: `bk_${Date.now()}`,
        slot_start,
        appointment_type,
        attendee_name,
        session_id,
        notes: notes || null,
        created_at: new Date().toISOString(),
        mock: config.mockMode,
      };
      store.bookings.push(record);
      return record;
    });

    console.log(`[calendar.book] booking=${booking.id} session=${session_id}`);

    res.status(200).json({ booked: true, booking_id: booking.id, slot_start, mock: config.mockMode });
  }
);
