import { eq, and, desc, gt, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { TenantScopedDb } from "../db/client";

// Formatting varies (E.164 vs. spoken-then-transcribed digits), so match on
// the last 10 digits rather than an exact string — robust to '+1', spaces,
// dashes, or a missing country code without risking false positives on
// short/garbage input.
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

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
  const normalized = normalizePhone(phone);
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
