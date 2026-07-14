import { eq, and, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { TenantScopedDb } from "../db/client";
import { config } from "../config";
import { phoneMatchKey, toE164 } from "../lib/phone";
import {
  RawLeadSignals,
  Scores,
  recomputeScores,
  stageForScore,
  defaultScores,
} from "./scoringService";

// Finds an existing lead by phone (last-10-digit match, format-independent —
// see phone.ts) so a returning caller's new call attaches to their existing
// lead instead of spawning a duplicate. Most recently updated wins if
// somehow more than one matches (pre-existing data, not something this path
// creates going forward).
async function findLeadByPhone(tx: TenantScopedDb, callerNumber: string) {
  const key = phoneMatchKey(callerNumber);
  if (key.length < 7) return null;
  const [lead] = await tx
    .select()
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.tenantId, config.tenantId),
        sql`right(regexp_replace(coalesce(${schema.leads.phone}, ''), '\D', '', 'g'), 10) = ${key}`
      )
    )
    .orderBy(sql`${schema.leads.updatedAt} desc`)
    .limit(1);
  return lead ?? null;
}

/**
 * VAPI's real call ID (see vapiTool.ts resolveCallId — never the LLM-supplied
 * session_id) is the call's identity across every tool call in one
 * conversation. This finds (or creates) the calls row for that call ID, and
 * the lead linked to it.
 *
 * When `callerNumber` is available (it always is for a real inbound phone
 * call — see extractToolCall) and this is a brand-new call with no lead yet,
 * an existing lead for that phone number is reused instead of creating a
 * duplicate, so a returning caller's whole history stays under one lead
 * regardless of how many separate calls they've made.
 */
export async function findOrCreateLeadForSession(
  tx: TenantScopedDb,
  callId: string,
  callerNumber?: string
): Promise<{ leadId: string; callId: string }> {
  const [existingCall] = await tx
    .select()
    .from(schema.calls)
    .where(and(eq(schema.calls.tenantId, config.tenantId), eq(schema.calls.vapiCallId, callId)));

  if (existingCall?.leadId) {
    return { leadId: existingCall.leadId, callId: existingCall.id };
  }

  const matchedLead = callerNumber ? await findLeadByPhone(tx, callerNumber) : null;

  let leadId: string;
  if (matchedLead) {
    leadId = matchedLead.id;
    // A caller reaching us again but with no phone on file yet (e.g. the
    // number came from a channel that couldn't set it originally) — backfill
    // it now that we have an authoritative one, normalized to E.164.
    if (!matchedLead.phone && callerNumber) {
      const normalized = toE164(callerNumber);
      if (normalized) {
        await tx.update(schema.leads).set({ phone: normalized, updatedAt: new Date() }).where(eq(schema.leads.id, leadId));
      }
    }
  } else {
    const scores = defaultScores();
    const normalizedPhone = callerNumber ? toE164(callerNumber) : null;
    const [lead] = await tx
      .insert(schema.leads)
      .values({
        tenantId: config.tenantId,
        phone: normalizedPhone,
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
    leadId = lead.id;
  }

  if (existingCall) {
    await tx.update(schema.calls).set({ leadId }).where(eq(schema.calls.id, existingCall.id));
    return { leadId, callId: existingCall.id };
  }

  const [call] = await tx
    .insert(schema.calls)
    .values({ tenantId: config.tenantId, leadId, vapiCallId: callId, startedAt: new Date() })
    .returning();

  return { leadId, callId: call.id };
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
