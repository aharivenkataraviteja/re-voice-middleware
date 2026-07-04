import { eq, and } from "drizzle-orm";
import * as schema from "../db/schema";
import type { TenantScopedDb } from "../db/client";
import { config } from "../config";
import {
  RawLeadSignals,
  Scores,
  recomputeScores,
  stageForScore,
  defaultScores,
} from "./scoringService";

/**
 * VAPI's session_id is the call's identity across every tool call in one
 * conversation. This finds (or creates) the calls row for that session, and
 * the lead linked to it — creating a new lead on first contact.
 */
export async function findOrCreateLeadForSession(
  tx: TenantScopedDb,
  sessionId: string
): Promise<{ leadId: string; callId: string }> {
  const [existingCall] = await tx
    .select()
    .from(schema.calls)
    .where(and(eq(schema.calls.tenantId, config.tenantId), eq(schema.calls.vapiCallId, sessionId)));

  if (existingCall?.leadId) {
    return { leadId: existingCall.leadId, callId: existingCall.id };
  }

  const scores = defaultScores();
  const [lead] = await tx
    .insert(schema.leads)
    .values({
      tenantId: config.tenantId,
      stage: "warm",
      scoreBi: String(scores.bi),
      scoreSi: String(scores.si),
      scoreFr: String(scores.fr),
      scoreUs: String(scores.us),
      scoreTs: String(scores.ts),
      scoreMc: String(scores.mc),
      scoreRf: String(scores.rf),
      scoreComposite: String(scores.composite),
    })
    .returning();

  if (existingCall) {
    await tx.update(schema.calls).set({ leadId: lead.id }).where(eq(schema.calls.id, existingCall.id));
    return { leadId: lead.id, callId: existingCall.id };
  }

  const [call] = await tx
    .insert(schema.calls)
    .values({ tenantId: config.tenantId, leadId: lead.id, vapiCallId: sessionId, startedAt: new Date() })
    .returning();

  return { leadId: lead.id, callId: call.id };
}

function readScores(lead: typeof schema.leads.$inferSelect): Scores {
  return {
    bi: Number(lead.scoreBi),
    si: Number(lead.scoreSi),
    fr: Number(lead.scoreFr),
    us: Number(lead.scoreUs),
    ts: Number(lead.scoreTs),
    mc: Number(lead.scoreMc),
    rf: Number(lead.scoreRf),
    composite: Number(lead.scoreComposite),
  };
}

/**
 * Applies raw signals to a lead's scores using the deterministic formulas in
 * scoringService.ts, updates its stage, and persists. Returns the updated
 * scores plus whether risk factor now forces an escalation.
 */
export async function applySignalsToLead(
  tx: TenantScopedDb,
  leadId: string,
  signals: RawLeadSignals
) {
  const [lead] = await tx.select().from(schema.leads).where(eq(schema.leads.id, leadId));
  if (!lead) throw new Error(`Lead not found: ${leadId}`);

  const current = readScores(lead);
  const updated = recomputeScores(current, signals);
  const stage = stageForScore(updated.composite);

  await tx
    .update(schema.leads)
    .set({
      scoreBi: String(updated.bi),
      scoreSi: String(updated.si),
      scoreFr: String(updated.fr),
      scoreUs: String(updated.us),
      scoreTs: String(updated.ts),
      scoreMc: String(updated.mc),
      scoreRf: String(updated.rf),
      scoreComposite: String(updated.composite),
      stage,
      updatedAt: new Date(),
    })
    .where(eq(schema.leads.id, leadId));

  return { scores: updated, stage };
}
