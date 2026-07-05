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

// Fallback when check_calendar_availability (or book_appointment) fails,
// times out, or otherwise can't return real scheduling options. Alex is
// instructed (see vapi_system_prompt.md, CALENDAR FAILURE FALLBACK) to
// collect minimum callback details instead of leaving the caller stuck, and
// call this so a human can follow up and lock in a real time. `phone` is
// required — the call must not end with zero contact info saved.
calendarRouter.post(
  "/tools/calendar/callback_request",
  verifyHmac(config.vapiToolSecret),
  async (req, res, next) => {
    const { caller_name, phone, email, preferred_day_time, reason, session_id } = req.body || {};

    if (!phone || !reason || !session_id) {
      return res.status(400).json({ error: "phone, reason, and session_id are required" });
    }

    try {
      const result = await withTenant(config.tenantId, async (tx) => {
        const { leadId } = await findOrCreateLeadForSession(tx, session_id);

        await tx
          .update(schema.leads)
          .set({
            callerName: caller_name || undefined,
            phone,
            email: email || undefined,
            intent: reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.leads.id, leadId));

        await tx.insert(schema.timelineEvents).values({
          tenantId: config.tenantId,
          leadId,
          eventType: "called",
          source: "ai",
          notes: `Scheduling system unavailable — callback requested. Preferred time: ${
            preferred_day_time || "not specified"
          }. Reason: ${reason}.`,
        });

        const [task] = await tx
          .insert(schema.tasks)
          .values({
            tenantId: config.tenantId,
            leadId,
            title: `Callback needed — lock in appointment time (${reason})${
              preferred_day_time ? `, prefers ${preferred_day_time}` : ""
            }`,
            source: "call",
            dueDate: new Date(),
            status: "open",
          })
          .returning();

        return { leadId, taskId: task.id };
      });

      console.log(`[calendar.callback_request] lead=${result.leadId} task=${result.taskId} session=${session_id}`);

      res.status(200).json({ logged: true, lead_id: result.leadId, task_id: result.taskId });
    } catch (err) {
      next(err);
    }
  }
);
