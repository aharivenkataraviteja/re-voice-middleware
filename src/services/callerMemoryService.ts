import { eq, and, desc, gt, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { TenantScopedDb } from "../db/client";
import { phoneMatchKey } from "../lib/phone";
import { getTenantAvailability } from "./availabilityService";
import { describeLocalDateTime } from "../lib/dateContext";
import { config } from "../config";

export type ReturningCallerResult =
  | { returning: false }
  | { returning: true; leadId: string; context: string };

/**
 * Looks up whether this phone number belongs to a lead we've already talked
 * to, and — if so — builds a short, caller-safe natural-language summary for
 * Alex to use to resume the conversation naturally. Deliberately excludes
 * anything internal-only (scores, stage, nurture tier, coach notes, raw task
 * titles) — only facts that are fine to reference back to the caller.
 */
export async function findReturningCallerContext(
  tx: TenantScopedDb,
  phone: string
): Promise<ReturningCallerResult> {
  const normalized = phoneMatchKey(phone);
  if (normalized.length < 7) return { returning: false };

  const leads = await tx
    .select()
    .from(schema.leads)
    .where(sql`right(regexp_replace(coalesce(${schema.leads.phone}, ''), '\D', '', 'g'), 10) = ${normalized}`)
    .orderBy(desc(schema.leads.updatedAt))
    .limit(1);

  const lead = leads[0];
  if (!lead) return { returning: false };

  const [lastCall] = await tx
    .select()
    .from(schema.calls)
    .where(eq(schema.calls.leadId, lead.id))
    .orderBy(desc(schema.calls.startedAt))
    .limit(1);

  const now = new Date();
  const [upcomingAppt] = await tx
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.leadId, lead.id),
        gt(schema.appointments.slotStart, now),
        eq(schema.appointments.status, "confirmed")
      )
    )
    .orderBy(schema.appointments.slotStart)
    .limit(1);

  const [openTask] = await tx
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.leadId, lead.id), eq(schema.tasks.status, "open")))
    .limit(1);

  const parts: string[] = [];
  if (lead.callerName) parts.push(`Caller's name is ${lead.callerName}.`);
  if (lead.intent) parts.push(`Last known interest: ${lead.intent}.`);
  if (lastCall?.summaryText) parts.push(`Summary of the last conversation: ${lastCall.summaryText}`);
  if (upcomingAppt) {
    parts.push(
      `They have an upcoming ${upcomingAppt.appointmentType || "appointment"} scheduled for ${upcomingAppt.slotStart.toISOString()}.`
    );
  }
  if (openTask) {
    parts.push("There is an open follow-up with our team for this caller.");
  }

  if (parts.length === 0) {
    // A lead record exists (e.g. from a very short prior call) but there's
    // nothing substantive to resume — treat as a fresh conversation rather
    // than force a stilted "welcome back" with no actual content.
    return { returning: false };
  }

  return { returning: true, leadId: lead.id, context: parts.join(" ") };
}

export interface AssistantRequestCallerContext {
  leadId: string;
  callerName: string | null;
  leadType: string | null;
  latestAppointmentLabel: string | null;
  assignedAgentName: string | null;
  context: string | null;
}

const MAX_CONTEXT_CHARS = 220;

/**
 * Structured, minimal-payload version of findReturningCallerContext for the
 * assistant-request webhook (see src/routes/assistantRequest.ts) — flat
 * fields suitable for Vapi's assistantOverrides.variableValues (which are
 * simple key/value strings, not nested JSON like a tool result). Excludes
 * everything findReturningCallerContext already excludes (scores, stage,
 * nurture tier, raw task titles), plus never returns a full transcript or
 * call summary verbatim — `context` is capped and drawn only from the same
 * caller-safe facts, not internal notes.
 */
export async function buildAssistantRequestContext(
  tx: TenantScopedDb,
  phone: string
): Promise<AssistantRequestCallerContext | null> {
  const normalized = phoneMatchKey(phone);
  if (normalized.length < 7) return null;

  const leads = await tx
    .select()
    .from(schema.leads)
    .where(sql`right(regexp_replace(coalesce(${schema.leads.phone}, ''), '\D', '', 'g'), 10) = ${normalized}`)
    .orderBy(desc(schema.leads.updatedAt))
    .limit(1);

  const lead = leads[0];
  if (!lead) return null;

  const now = new Date();
  const [upcomingAppt] = await tx
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.leadId, lead.id),
        gt(schema.appointments.slotStart, now),
        eq(schema.appointments.status, "confirmed")
      )
    )
    .orderBy(schema.appointments.slotStart)
    .limit(1);

  let assignedAgentName: string | null = null;
  if (lead.assignedAgentId) {
    const [agent] = await tx
      .select({ fullName: schema.users.fullName, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, lead.assignedAgentId));
    assignedAgentName = agent ? agent.fullName || agent.email : null;
  }

  let latestAppointmentLabel: string | null = null;
  if (upcomingAppt) {
    const availability = await getTenantAvailability(tx, config.tenantId);
    latestAppointmentLabel = describeLocalDateTime(upcomingAppt.slotStart, availability.timezone, now);
  }

  const contextParts: string[] = [];
  if (lead.intent) contextParts.push(`Interested in ${lead.intent}.`);
  const [lastCall] = await tx
    .select({ summaryText: schema.calls.summaryText })
    .from(schema.calls)
    .where(eq(schema.calls.leadId, lead.id))
    .orderBy(desc(schema.calls.startedAt))
    .limit(1);
  if (lastCall?.summaryText) contextParts.push(lastCall.summaryText);
  const context = contextParts.length ? contextParts.join(" ").slice(0, MAX_CONTEXT_CHARS) : null;

  return {
    leadId: lead.id,
    callerName: lead.callerName,
    // `intent` sometimes holds a short category ("buyer") and sometimes a
    // full callback-reason sentence (log_callback_request) — capped here so
    // this stays a minimal field either way, consistent with `context`.
    leadType: lead.intent ? lead.intent.slice(0, 60) : null,
    latestAppointmentLabel,
    assignedAgentName,
    context,
  };
}
