import { Router } from "express";
import { eq } from "drizzle-orm";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { findOrCreateLeadForSession } from "../../services/leadService";
import { getTenantAvailability } from "../../services/availabilityService";
import { generateAvailableSlots } from "../../lib/slotGeneration";
import { localDateString } from "../../lib/dateContext";
import { toE164 } from "../../lib/phone";
import {
  getConnection,
  getAnyConnectedAgentId,
  checkFreeBusy,
  createCalendarEvent,
  markConnectionError,
} from "../../services/googleCalendarService";
import { extractToolCall, resolveCallId, sendToolResult, sendToolError } from "../../lib/vapiTool";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const calendarRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveConnectedAgent(tx: Parameters<typeof getConnection>[0], requestedAgentId?: string) {
  if (requestedAgentId && UUID_PATTERN.test(requestedAgentId)) {
    const connection = await getConnection(tx, requestedAgentId);
    if (connection?.status === "connected") return connection;
    return null;
  }
  // "auto" (or no agent specified) — any agent with a real connected
  // calendar. No routing/specialty logic yet (single-tenant pilot); this is
  // the same "first available" simplification appointments.ts already uses
  // for the mock scheduler.
  const agentId = await getAnyConnectedAgentId(tx);
  if (!agentId) return null;
  return getConnection(tx, agentId);
}

calendarRouter.post("/tools/calendar/availability", verifyHmac(config.vapiToolSecret), async (req, res, next) => {
  const { toolCallId, args } = extractToolCall(req);
  const { agent_id, caller_timezone, requested_date } = args;

  // requested_date must already be a resolved ISO date (see
  // vapi_system_prompt.md's DATE & TIME RESOLUTION section — Alex resolves
  // relative phrases like "this Thursday" against date_context from
  // lookup_caller_history and passes the concrete date here, never a phrase).
  // An unparseable value is ignored rather than failing the whole lookup —
  // falls back to the original "next 7 days" behavior.
  const hasRequestedDate = typeof requested_date === "string" && ISO_DATE_PATTERN.test(requested_date);

  try {
    const result = await withTenant(config.tenantId, async (tx) => {
      const connection = await resolveConnectedAgent(tx, agent_id);
      if (!connection) return { connected: false as const };

      const availability = await getTenantAvailability(tx, config.tenantId);
      const timeZone = caller_timezone || availability.timezone;
      let timeMin: Date;
      let timeMax: Date;
      if (hasRequestedDate) {
        // Wide net (±1 day in UTC) around the requested calendar date, exact
        // day boundaries applied afterward via localDateString — casting a
        // wide net first and filtering precisely after avoids needing a
        // separate UTC-offset/DST calculation just to find local midnight.
        const [y, m, d] = requested_date.split("-").map(Number);
        const centerUtc = Date.UTC(y, m - 1, d);
        timeMin = new Date(centerUtc - 24 * 60 * 60 * 1000);
        timeMax = new Date(centerUtc + 48 * 60 * 60 * 1000);
      } else {
        timeMin = new Date();
        timeMax = new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);
      }

      try {
        const busy = await checkFreeBusy(connection, timeMin, timeMax);
        let slots = generateAvailableSlots({
          timeMin,
          timeMax,
          timeZone,
          businessHours: availability.businessHours,
          busy,
          maxSlots: hasRequestedDate ? 20 : 2, // wide net first, trimmed to 2 after the exact-date filter below
        });
        if (hasRequestedDate) {
          slots = slots.filter((s) => localDateString(s, timeZone) === requested_date).slice(0, 2);
        }
        return { connected: true as const, agentId: connection.agentId, slots, timeZone };
      } catch (err) {
        console.error(`[calendar.availability] Google API failure for agent=${connection.agentId}`, err);
        await markConnectionError(tx, connection.agentId, err instanceof Error ? err.message : "unknown_error");
        return { connected: true as const, agentId: connection.agentId, slots: null, timeZone };
      }
    });

    if (!result.connected) {
      // No agent has a real calendar connected — same fallback the system
      // always had: mock slots in mock mode, otherwise a clear "not
      // configured" failure that triggers Alex's S09B_CAL_FAIL fallback.
      if (config.mockMode) {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        return sendToolResult(res, toolCallId, {
          slots: [
            { start: new Date(now + day).toISOString(), format: "in-person" },
            { start: new Date(now + 2 * day).toISOString(), format: "virtual" },
          ],
          mock: true,
        });
      }
      return sendToolError(res, toolCallId, "no_calendar_connected");
    }

    if (result.slots === null) {
      // A real connection exists but the Google API call itself failed
      // (expired/revoked token, network error, etc.) — never fall back to
      // fabricated mock slots here; that would violate "never offer a time
      // unless Google confirms availability." Fail loudly so the prompt's
      // fallback path fires instead.
      return sendToolError(res, toolCallId, "google_calendar_unavailable");
    }

    sendToolResult(res, toolCallId, {
      slots: result.slots.map((s) => ({ start: s.toISOString(), format: "in-person" })),
      mock: false,
      agent_id: result.agentId,
      resolved_date: hasRequestedDate ? requested_date : undefined,
      timezone: result.timeZone,
    });
  } catch (err) {
    next(err);
  }
});

calendarRouter.post("/tools/calendar/book", verifyHmac(config.vapiToolSecret), async (req, res, next) => {
  const { toolCallId, args, realCallId, callerNumber } = extractToolCall(req);
  const {
    slot_start,
    appointment_type,
    format,
    attendee_name,
    attendee_phone,
    attendee_email,
    agent_id,
    session_id,
    notes,
  } = args;

  if (!slot_start || !appointment_type || !attendee_name || !attendee_phone || !session_id) {
    return sendToolError(res, toolCallId, "missing required booking fields");
  }

  const callId = resolveCallId(realCallId, session_id, "book_appointment");
  // The webhook envelope's own customer.number is authoritative for phone
  // storage/matching (see leadService's dedup-by-phone) — attendee_phone is
  // whatever the LLM transcribed from speech and is only used as a fallback
  // if the envelope's number is somehow unavailable.
  const normalizedPhone = toE164(callerNumber || attendee_phone) || attendee_phone;

  try {
    const outcome = await withTenant(config.tenantId, async (tx) => {
      const { leadId, callId: dbCallId } = await findOrCreateLeadForSession(tx, callId, callerNumber);

      await tx
        .update(schema.leads)
        .set({
          callerName: attendee_name,
          phone: normalizedPhone,
          email: attendee_email || undefined,
          updatedAt: new Date(),
        })
        .where(eq(schema.leads.id, leadId));

      const connection = await resolveConnectedAgent(tx, agent_id);
      const slotStart = new Date(slot_start);
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

      let googleEventId: string | null = null;
      if (connection) {
        const availability = await getTenantAvailability(tx, config.tenantId);
        const callLink = dbCallId ? `https://re-voice-middleware-production.up.railway.app/calls/${dbCallId}` : null;
        const description = [
          `Caller: ${attendee_name}`,
          `Phone: ${attendee_phone}`,
          attendee_email ? `Email: ${attendee_email}` : null,
          notes ? `Reason: ${notes}` : null,
          callLink ? `Call summary: ${callLink}` : null,
          "Booked by Alex (RE-VOICE).",
        ]
          .filter(Boolean)
          .join("\n");

        try {
          googleEventId = await createCalendarEvent(connection, {
            summary: `${appointment_type} — ${attendee_name}`,
            description,
            start: slotStart,
            end: slotEnd,
            timeZone: availability.timezone,
            attendeeEmail: attendee_email || undefined,
          });
        } catch (err) {
          console.error(`[calendar.book] Google event creation failed for agent=${connection.agentId}`, err);
          await markConnectionError(tx, connection.agentId, err instanceof Error ? err.message : "unknown_error");
          // Do not silently fall back to a mock booking here — a caller was
          // just told this specific time is confirmed. Surface the failure
          // so Alex's S09B_CAL_FAIL fallback (book_appointment failing after
          // a slot was presented) takes over instead of a fake confirmation.
          return { failed: true as const };
        }
      } else if (!config.mockMode) {
        return { failed: true as const };
      }

      const [appointment] = await tx
        .insert(schema.appointments)
        .values({
          tenantId: config.tenantId,
          leadId,
          callId: dbCallId,
          agentId: connection?.agentId,
          slotStart,
          appointmentType: appointment_type,
          format: format || null,
          notes: notes || null,
          status: "confirmed",
          googleEventId,
        })
        .returning();

      await tx.insert(schema.timelineEvents).values({
        tenantId: config.tenantId,
        leadId,
        eventType: "appointment_booked",
        source: "ai",
        notes: `${appointment_type} at ${slot_start}`,
      });

      return { failed: false as const, appointment };
    });

    if (outcome.failed) {
      return sendToolError(res, toolCallId, "booking_failed");
    }

    console.log(`[calendar.book] booking=${outcome.appointment.id} call=${callId} real=${Boolean(outcome.appointment.googleEventId)}`);

    sendToolResult(res, toolCallId, {
      booked: true,
      booking_id: outcome.appointment.id,
      slot_start,
      mock: !outcome.appointment.googleEventId,
    });
  } catch (err) {
    next(err);
  }
});

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
    const { toolCallId, args, realCallId, callerNumber } = extractToolCall(req);
    const { caller_name, phone, email, preferred_day_time, reason, session_id } = args;

    if (!phone || !reason || !session_id) {
      return sendToolError(res, toolCallId, "phone, reason, and session_id are required");
    }

    const callId = resolveCallId(realCallId, session_id, "log_callback_request");
    const normalizedPhone = toE164(callerNumber || phone) || phone;

    try {
      const result = await withTenant(config.tenantId, async (tx) => {
        const { leadId } = await findOrCreateLeadForSession(tx, callId, callerNumber);

        await tx
          .update(schema.leads)
          .set({
            callerName: caller_name || undefined,
            phone: normalizedPhone,
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
            source: "calendar_failure",
            dueDate: new Date(),
            status: "open",
          })
          .returning();

        return { leadId, taskId: task.id };
      });

      console.log(`[calendar.callback_request] lead=${result.leadId} task=${result.taskId} session=${session_id}`);

      sendToolResult(res, toolCallId, { logged: true, lead_id: result.leadId, task_id: result.taskId });
    } catch (err) {
      next(err);
    }
  }
);
