import { Router } from "express";
import { eq } from "drizzle-orm";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { findOrCreateLeadForSession } from "../../services/leadService";
import { getTenantAvailability, DEFAULT_AVAILABILITY } from "../../services/availabilityService";
import { generateAvailableSlots, isTimeOfDay, timeOfDayRangeFor, timeOfDayBucketFor, parseTimeToMinutes, TIME_HHMM_PATTERN } from "../../lib/slotGeneration";
import { localDateString, describeLocalDateTime } from "../../lib/dateContext";
import { toE164 } from "../../lib/phone";
import {
  getConnection,
  getAnyConnectedAgentId,
  checkFreeBusy,
  createCalendarEvent,
  markConnectionError,
  isReconnectRequiredError,
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
  const { agent_id, caller_timezone, requested_date, time_of_day, requested_time } = args;
  const timeOfDay = isTimeOfDay(time_of_day) ? time_of_day : undefined;
  // An exact clock time ("2 PM" -> "14:00") takes priority over a vague
  // time_of_day word when both are somehow present — checked for the exact
  // requested minute first, falling back to the bucket containing it (not
  // the whole day) if that precise slot isn't free. Since slots only ever
  // land on the hour (see generateAvailableSlots), a non-hour requested_time
  // (e.g. "14:30") will correctly never match anything — there's nothing to
  // silently round to.
  const requestedTimeMinutes =
    typeof requested_time === "string" && TIME_HHMM_PATTERN.test(requested_time) ? parseTimeToMinutes(requested_time) : undefined;

  // requested_date should already be a resolved ISO date (see
  // vapi_system_prompt.md's DATE & TIME RESOLUTION section — Alex resolves
  // relative phrases like "this Thursday" against date_context from
  // lookup_caller_history and passes the concrete date here, never a phrase).
  // In practice the model doesn't reliably do this — observed in production
  // sending a plausible-looking but wrong-year ISO date (its own guess, not
  // date_context) when the lookup tool hadn't fired. A value outside a sane
  // near-term booking window is exactly what that failure mode produces, so
  // it's treated the same as no date at all (falls back to the "next 7 days"
  // window) rather than searching a real calendar against a nonsense date
  // and reporting zero availability as if scheduling were actually down.
  const requestedDateInWindow = (() => {
    if (typeof requested_date !== "string" || !ISO_DATE_PATTERN.test(requested_date)) return false;
    const parsed = Date.parse(`${requested_date}T00:00:00Z`);
    if (Number.isNaN(parsed)) return false;
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    return parsed >= now - DAY_MS && parsed <= now + 120 * DAY_MS;
  })();
  if (typeof requested_date === "string" && !requestedDateInWindow) {
    console.warn(`[calendar.availability] ignoring implausible requested_date="${requested_date}" (not within [today-1d, today+120d]) — falling back to default window`);
  }
  const hasRequestedDate = requestedDateInWindow;

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
        // Never below "now" — observed in a real call: with requested_date
        // equal to today, this wide net's lower bound (yesterday) let slots
        // generate from the start of today regardless of the actual current
        // time, offering appointment times already in the past (e.g. 9 AM
        // slots offered as available at 1 PM). The exact-date filter below
        // only checks the calendar day, not that the slot is still ahead of
        // right now.
        const [y, m, d] = requested_date.split("-").map(Number);
        const centerUtc = Date.UTC(y, m - 1, d);
        timeMin = new Date(Math.max(centerUtc - 24 * 60 * 60 * 1000, Date.now()));
        timeMax = new Date(centerUtc + 48 * 60 * 60 * 1000);
      } else {
        timeMin = new Date();
        timeMax = new Date(timeMin.getTime() + 7 * 24 * 60 * 60 * 1000);
      }

      try {
        const busy = await checkFreeBusy(connection, timeMin, timeMax);
        const genSlots = (range: { startMinutes: number; endMinutes: number } | undefined) => {
          let s = generateAvailableSlots({
            timeMin,
            timeMax,
            timeZone,
            businessHours: availability.businessHours,
            busy,
            maxSlots: hasRequestedDate ? 20 : 2, // wide net first, trimmed to 2 after the exact-date filter below
            preferredRange: range,
          });
          if (hasRequestedDate) {
            s = s.filter((x) => localDateString(x, timeZone) === requested_date).slice(0, 2);
          }
          return s;
        };

        // Three-tier search, each tier only tried if the previous one came
        // up empty — never silently jump straight to "earliest of the day"
        // (observed in a real call: caller asked for 2 PM Tuesday, got told
        // "our latest options are 9 AM or 10 AM," which was only true
        // because nothing later had actually been checked).
        // Tier 1: the exact requested clock time, if one was given.
        // Tier 2: the broader part-of-day bucket containing either the exact
        //         time or the stated time_of_day word.
        // Tier 3: no preference at all — truly the earliest slots that day.
        let slots: Date[] = [];
        let requestedTimeMatched: boolean | undefined;
        let effectiveTimeOfDay = timeOfDay;

        if (requestedTimeMinutes !== undefined) {
          slots = genSlots({ startMinutes: requestedTimeMinutes, endMinutes: requestedTimeMinutes + 1 });
          requestedTimeMatched = slots.length > 0;
          if (!requestedTimeMatched) {
            effectiveTimeOfDay = timeOfDayBucketFor(requestedTimeMinutes);
          }
        }

        let timeOfDayMatched = true;
        if (slots.length === 0 && effectiveTimeOfDay) {
          slots = genSlots(timeOfDayRangeFor(effectiveTimeOfDay));
          timeOfDayMatched = slots.length > 0;
        }

        if (slots.length === 0) {
          timeOfDayMatched = requestedTimeMinutes !== undefined || timeOfDay ? false : true;
          slots = genSlots(undefined);
        }

        return {
          connected: true as const,
          agentId: connection.agentId,
          slots,
          timeZone,
          timeOfDay: effectiveTimeOfDay,
          timeOfDayMatched,
          requestedTimeMinutes,
          requestedTimeMatched,
        };
      } catch (err) {
        console.error(`[calendar.availability] Google API failure for agent=${connection.agentId}`, err);
        // Only flip the dashboard to "Needs reconnect" for a genuine
        // auth-layer failure — a transient network/rate-limit error isn't
        // fixed by reconnecting and shouldn't tell an agent it is.
        if (isReconnectRequiredError(err)) {
          await markConnectionError(tx, connection.agentId, err instanceof Error ? err.message : "unknown_error");
        }
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
        const tz = DEFAULT_AVAILABILITY.timezone;
        const slot1 = new Date(now + day);
        const slot2 = new Date(now + 2 * day);
        return sendToolResult(res, toolCallId, {
          slots: [
            { start: slot1.toISOString(), format: "in-person", label: describeLocalDateTime(slot1, tz) },
            { start: slot2.toISOString(), format: "virtual", label: describeLocalDateTime(slot2, tz) },
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
      // `label` is the only thing Alex should speak — see DATE & TIME
      // RESOLUTION. `start` is still included for book_appointment's
      // slot_start argument, but must never be translated into speech
      // directly (observed hallucinating "today" for a slot 13+ hours away).
      slots: result.slots.map((s) => ({ start: s.toISOString(), format: "in-person", label: describeLocalDateTime(s, result.timeZone) })),
      mock: false,
      agent_id: result.agentId,
      resolved_date: hasRequestedDate ? requested_date : undefined,
      timezone: result.timeZone,
      // See S09_APPT_SET — when a time_of_day (or exact requested_time) was
      // requested but nothing matched, these slots are the closest fallback,
      // NOT a match for what the caller asked for. Alex must say so
      // explicitly, never present them as if they satisfied the preference.
      time_of_day_requested: result.timeOfDay,
      time_of_day_matched: result.timeOfDay ? result.timeOfDayMatched : undefined,
      requested_time,
      requested_time_matched: result.requestedTimeMinutes !== undefined ? result.requestedTimeMatched : undefined,
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
    attendee_phone: llmAttendeePhone,
    attendee_email,
    agent_id,
    session_id,
    notes,
  } = args;

  // The LLM doesn't always re-ask for/re-supply a phone number once it
  // already recognizes the caller (observed in a real reschedule call —
  // book_appointment failed with "missing required booking fields" because
  // attendee_phone was simply absent from the arguments, even though the
  // caller's real number was sitting right there in the webhook envelope
  // the whole time). Same "derive, don't require from the LLM" fallback
  // already used for the call ID.
  const attendee_phone = llmAttendeePhone || callerNumber;
  // Resolve BEFORE validating — resolveCallId always returns a real,
  // non-empty ID as long as the webhook envelope has message.call.id
  // (true for every real inbound call). Validating the LLM's raw
  // session_id first defeats that fallback entirely: observed in a real
  // call where the LLM sent session_id="" (empty string, not merely
  // missing) and the whole booking was rejected as "missing required
  // fields" before resolveCallId ever ran — silently dropping a caller's
  // reschedule request with no trace in the database at all.
  const callId = resolveCallId(realCallId, session_id, "book_appointment");

  if (!slot_start || !appointment_type || !attendee_name || !attendee_phone) {
    return sendToolError(res, toolCallId, "missing required booking fields");
  }
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
      const availability = await getTenantAvailability(tx, config.tenantId);

      let googleEventId: string | null = null;
      if (connection) {
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
          if (isReconnectRequiredError(err)) {
            await markConnectionError(tx, connection.agentId, err instanceof Error ? err.message : "unknown_error");
          }
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

      return { failed: false as const, appointment, timeZone: availability.timezone };
    });

    if (outcome.failed) {
      return sendToolError(res, toolCallId, "booking_failed");
    }

    console.log(`[calendar.book] booking=${outcome.appointment.id} call=${callId} real=${Boolean(outcome.appointment.googleEventId)}`);

    sendToolResult(res, toolCallId, {
      booked: true,
      booking_id: outcome.appointment.id,
      slot_start,
      // See DATE & TIME RESOLUTION — Alex must speak this label, not
      // reconstruct the day/time from slot_start itself.
      label: describeLocalDateTime(new Date(slot_start), outcome.timeZone),
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
    const { caller_name, phone: llmPhone, email, preferred_day_time, reason, session_id } = args;
    // Same fallback as book_appointment — the LLM doesn't always re-supply a
    // phone number once it already recognizes the caller (observed: an
    // empty phone argument on this exact tool in a real call, which this
    // route's own validation below then silently rejected — the caller's
    // callback request was never actually logged).
    const phone = llmPhone || callerNumber;
    // Resolve BEFORE validating — see book_appointment's comment above.
    // Same real-call bug hit this route too: session_id="" (empty string)
    // silently killed a caller's reschedule-fallback request, so nothing —
    // not even a task — was ever logged for the team to follow up on.
    const callId = resolveCallId(realCallId, session_id, "log_callback_request");

    if (!phone || !reason) {
      return sendToolError(res, toolCallId, "phone and reason are required");
    }

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
