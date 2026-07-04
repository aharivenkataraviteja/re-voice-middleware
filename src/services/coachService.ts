import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { TenantScopedDb } from "../db/client";
import * as schema from "../db/schema";

export interface WeeklyMetrics {
  callsAnswered: number;
  appointmentsBooked: number;
  transfersEscalated: number;
  avgCallDurationSeconds: number | null;
  hangUpAfter7pmCount: number;
  appointmentRateChangePct: number | null;
}

export async function computeWeeklyMetrics(
  tx: TenantScopedDb,
  tenantId: string,
  weekStart: Date
): Promise<WeeklyMetrics> {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const thisWeekCalls = await tx
    .select()
    .from(schema.calls)
    .where(and(gte(schema.calls.startedAt, weekStart), lte(schema.calls.startedAt, weekEnd)));

  const thisWeekAppointments = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.timelineEvents)
    .where(
      and(
        eq(schema.timelineEvents.eventType, "appointment_booked"),
        gte(schema.timelineEvents.eventDate, weekStart),
        lte(schema.timelineEvents.eventDate, weekEnd)
      )
    );

  const prevWeekAppointments = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.timelineEvents)
    .where(
      and(
        eq(schema.timelineEvents.eventType, "appointment_booked"),
        gte(schema.timelineEvents.eventDate, prevWeekStart),
        lte(schema.timelineEvents.eventDate, weekStart)
      )
    );

  const escalations = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(and(gte(schema.tasks.createdAt, weekStart), lte(schema.tasks.createdAt, weekEnd)));

  const durations = thisWeekCalls.map((c) => c.durationSeconds).filter((d): d is number => d != null);
  const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  const afterHoursCount = thisWeekCalls.filter((c) => c.startedAt && c.startedAt.getHours() >= 19).length;

  const thisCount = thisWeekAppointments[0]?.count ?? 0;
  const prevCount = prevWeekAppointments[0]?.count ?? 0;
  const changePct = prevCount > 0 ? Math.round(((thisCount - prevCount) / prevCount) * 100) : null;

  return {
    callsAnswered: thisWeekCalls.length,
    appointmentsBooked: thisCount,
    transfersEscalated: escalations[0]?.count ?? 0,
    avgCallDurationSeconds: avgDuration,
    hangUpAfter7pmCount: afterHoursCount,
    appointmentRateChangePct: changePct,
  };
}

/**
 * Turns computed metrics into the narrative Coach Note. No LLM API key is
 * currently wired into this middleware (RE-VOICE's conversational LLM calls
 * all happen inside VAPI, not here), so this generates a real, data-grounded
 * note from a template rather than block on adding a new external
 * dependency. Swap in a real LLM call here once an API key is provisioned —
 * the metrics computation above doesn't change either way.
 */
export function narrateMetrics(m: WeeklyMetrics): { content: string; generatedBy: "llm" | "template" } {
  const lines: string[] = [];

  if (m.hangUpAfter7pmCount > 0) {
    lines.push(
      `${m.hangUpAfter7pmCount} call${m.hangUpAfter7pmCount === 1 ? "" : "s"} came in after 7 PM this week.`
    );
  }
  if (m.appointmentRateChangePct != null) {
    const direction = m.appointmentRateChangePct >= 0 ? "increased" : "decreased";
    lines.push(`Appointments booked ${direction} ${Math.abs(m.appointmentRateChangePct)}% versus last week.`);
  }
  lines.push(`${m.callsAnswered} calls answered, ${m.appointmentsBooked} appointments booked.`);
  if (m.transfersEscalated > 0) {
    lines.push(`${m.transfersEscalated} call${m.transfersEscalated === 1 ? "" : "s"} escalated to a human agent.`);
  }
  if (m.avgCallDurationSeconds != null) {
    lines.push(`Average call length: ${Math.round(m.avgCallDurationSeconds / 60)} minutes.`);
  }

  return { content: lines.join(" "), generatedBy: "template" };
}
