// Deterministic scoring, ported directly from middleware_rules.json. The LLM
// never sets these — it only surfaces raw signals (timeline_days,
// is_cash_buyer, etc.) via tool call fields; everything here is middleware's
// job, computed the same way every time.

export interface RawLeadSignals {
  timelineDays?: number | null;
  timelineSemantic?: "someday" | "eventually" | "next_year" | null;
  isCashBuyer?: boolean | null;
  preApproved?: boolean | null;
  preApprovalStatus?: "in_process" | "approved" | "none" | null;
  priceRangeStated?: boolean | null;
  creditConcernMentioned?: boolean | null;
  // Trust-score trigger flags — any subset may be present on a given call.
  referralSourceConfirmed?: boolean;
  appointmentAcceptedTurn1?: boolean;
  emotionalMotivationShared?: boolean;
  highEngagementDetected?: boolean;
  priorAgentNegativeMention?: boolean;
  commissionQuestion?: boolean;
  asksAreYouHuman?: boolean;
  silenceOnFinanceQuestion?: boolean;
  existingAgentMentioned?: boolean;
  appointmentDeclinedTwice?: boolean;
  // Risk-factor triggers
  legalLanguageDetected?: boolean;
  foreclosureMentioned?: boolean;
  divorceMentioned?: boolean;
  callerRequestsHuman?: boolean;
  repeatQuestionDetected?: boolean;
  searchFatigue6moPlus?: boolean;
  mediaInquiryDetected?: boolean;
  // Buyer/Seller intent + engagement + motivation-clarity — these come from
  // wherever the lead currently stands (existing scores), not recomputed
  // from a single call's signals the same way US/FR/RF are.
  buyerIntent?: number;
  sellerIntent?: number;
  engagement?: number;
  motivationClarity?: number;
}

export interface Scores {
  bi: number;
  si: number;
  fr: number;
  us: number;
  ts: number;
  mc: number;
  rf: number;
  composite: number;
}

const DEFAULT_SCORES: Scores = { bi: 3, si: 3, fr: 3, us: 3, ts: 5, mc: 3, rf: 0, composite: 3 };

export function scoreUrgency(signals: RawLeadSignals): number {
  const { timelineDays, timelineSemantic } = signals;
  if (timelineSemantic === "someday") return 1;
  if (timelineSemantic === "eventually") return 2;
  if (timelineSemantic === "next_year") return 3;
  if (timelineDays == null) return 3; // UNKNOWN baseline — never guessed
  if (timelineDays <= 14) return 10;
  if (timelineDays <= 30) return 9;
  if (timelineDays <= 60) return 7;
  if (timelineDays <= 90) return 6;
  if (timelineDays <= 180) return 5;
  if (timelineDays <= 365) return 3;
  return 1;
}

export function scoreFinancialReadiness(signals: RawLeadSignals): number {
  if (signals.isCashBuyer) return 10;
  if (signals.preApproved) return 8;
  if (signals.preApprovalStatus === "in_process") return 5;
  if (signals.priceRangeStated && signals.preApproved === false) return 4;
  if (signals.priceRangeStated) return 3;
  if (signals.creditConcernMentioned) return 1;
  return 3; // baseline — middleware never guesses
}

const TRUST_DELTAS: Array<[keyof RawLeadSignals, number]> = [
  ["referralSourceConfirmed", 3],
  ["appointmentAcceptedTurn1", 2],
  ["emotionalMotivationShared", 2],
  ["highEngagementDetected", 2],
  ["priorAgentNegativeMention", -2],
  ["commissionQuestion", -1],
  ["asksAreYouHuman", -1],
  ["silenceOnFinanceQuestion", -1],
  ["existingAgentMentioned", -1],
  ["appointmentDeclinedTwice", -2],
];

export function applyTrustDeltas(currentTs: number, signals: RawLeadSignals): number {
  let ts = currentTs;
  for (const [key, delta] of TRUST_DELTAS) {
    if (signals[key]) ts += delta;
  }
  return Math.max(0, Math.min(10, ts));
}

const RISK_TRIGGERS: Array<[keyof RawLeadSignals, number]> = [
  ["legalLanguageDetected", 3],
  ["foreclosureMentioned", 3],
  ["divorceMentioned", 2],
  ["commissionQuestion", 1],
  ["priorAgentNegativeMention", 1],
  ["existingAgentMentioned", 1],
  ["callerRequestsHuman", 1],
  ["repeatQuestionDetected", 1],
  ["searchFatigue6moPlus", 1],
  ["mediaInquiryDetected", 5],
];

export function applyRiskFactor(currentRf: number, signals: RawLeadSignals): number {
  let rf = currentRf;
  for (const [key, add] of RISK_TRIGGERS) {
    if (signals[key]) rf += add;
  }
  return rf;
}

export function compositeLeadScore(s: Omit<Scores, "composite">): number {
  const raw = s.bi * 0.18 + s.si * 0.18 + s.us * 0.2 + s.fr * 0.2 + s.ts * 0.14 + s.mc * 0.08 + 0 /* ER unused for v1 */ * 0.08;
  const rfPenalty = s.rf >= 3 ? 0.1 : 0;
  return Math.round(raw * (1 - rfPenalty) * 100) / 100;
}

export function recomputeScores(current: Scores, signals: RawLeadSignals): Scores {
  const bi = signals.buyerIntent ?? current.bi;
  const si = signals.sellerIntent ?? current.si;
  const mc = signals.motivationClarity ?? current.mc;
  const us = scoreUrgency(signals);
  const fr = scoreFinancialReadiness(signals);
  const ts = applyTrustDeltas(current.ts, signals);
  const rf = applyRiskFactor(current.rf, signals);
  const composite = compositeLeadScore({ bi, si, us, fr, ts, mc, rf });
  return { bi, si, fr, us, ts, mc, rf, composite };
}

export function stageForScore(composite: number): "hot" | "warm" | "cold" {
  // hot_leads_pct definition (observability_config.json): CL >= 7.0
  if (composite >= 7) return "hot";
  if (composite >= 4) return "warm";
  return "cold";
}

export function defaultScores(): Scores {
  return { ...DEFAULT_SCORES };
}

// Force-escalation thresholds from middleware_rules.json's risk_factor_rules.
export function riskForcesEscalation(rf: number): boolean {
  return rf >= 5;
}
