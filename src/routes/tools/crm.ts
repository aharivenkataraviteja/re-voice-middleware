import { Router } from "express";
import { eq } from "drizzle-orm";
import { verifyHmac } from "../../hmac";
import { config } from "../../config";
import { withTenant } from "../../db/client";
import * as schema from "../../db/schema";
import { findOrCreateLeadForSession, applySignalsToLead } from "../../services/leadService";
import type { RawLeadSignals } from "../../services/scoringService";
import { extractToolCall, sendToolResult, sendToolError } from "../../lib/vapiTool";

export const crmRouter = Router();

// Maps the free-form `fields`/`activity` payload Alex can send into this
// tool onto the raw signal names scoringService.ts expects. Only a subset
// will be present on any given call — recomputeScores() falls back to
// existing/baseline values for anything absent, never guesses.
function extractSignals(fields: Record<string, unknown> | undefined): RawLeadSignals {
  if (!fields) return {};
  return {
    timelineDays: typeof fields.timeline_days === "number" ? fields.timeline_days : undefined,
    isCashBuyer: typeof fields.is_cash_buyer === "boolean" ? fields.is_cash_buyer : undefined,
    preApproved: typeof fields.pre_approved === "boolean" ? fields.pre_approved : undefined,
    preApprovalStatus:
      fields.pre_approval_status === "in_process" || fields.pre_approval_status === "approved"
        ? (fields.pre_approval_status as "in_process" | "approved")
        : undefined,
    priceRangeStated: fields.budget_floor != null || fields.budget_ceiling != null ? true : undefined,
    referralSourceConfirmed: fields.referral_source ? true : undefined,
    existingAgentMentioned: typeof fields.existing_agent_mentioned === "boolean" ? fields.existing_agent_mentioned : undefined,
    foreclosureMentioned: typeof fields.distress_flag === "boolean" ? fields.distress_flag : undefined,
  };
}

crmRouter.post("/tools/crm/update", verifyHmac(config.vapiToolSecret), async (req, res, next) => {
  const { toolCallId, args } = extractToolCall(req);
  const { session_id, action, fields, activity } = args;
  if (!session_id || !action) {
    return sendToolError(res, toolCallId, "session_id and action are required");
  }

  try {
    const result = await withTenant(config.tenantId, async (tx) => {
      const { leadId } = await findOrCreateLeadForSession(tx, session_id);

      const patch: Partial<typeof schema.leads.$inferInsert> = { updatedAt: new Date() };
      if (fields?.first_name || fields?.last_name) {
        patch.callerName = [fields.first_name, fields.last_name].filter(Boolean).join(" ");
      }
      if (fields?.phone) patch.phone = fields.phone;
      if (fields?.email) patch.email = fields.email;
      if (fields?.lead_type) patch.intent = fields.lead_type;
      if (fields?.nurture_tier) patch.nurtureTier = fields.nurture_tier;
      if (typeof fields?.budget_floor === "number") patch.budgetFloor = String(fields.budget_floor);
      if (typeof fields?.budget_ceiling === "number") patch.budgetCeiling = String(fields.budget_ceiling);

      if (Object.keys(patch).length > 1) {
        await tx.update(schema.leads).set(patch).where(eq(schema.leads.id, leadId));
      }

      const signals = extractSignals(fields);
      const { scores, stage } = await applySignalsToLead(tx, leadId, signals);

      if (activity) {
        await tx.insert(schema.timelineEvents).values({
          tenantId: config.tenantId,
          leadId,
          eventType: "called",
          source: "ai",
          notes: [activity.subject, activity.body].filter(Boolean).join(": ") || activity.outcome || null,
        });
      }

      return { leadId, scores, stage };
    });

    console.log(`[crm.update] action=${action} lead=${result.leadId} stage=${result.stage} session=${session_id}`);

    sendToolResult(res, toolCallId, { updated: true, contact_id: result.leadId, mock: config.mockMode });
  } catch (err) {
    next(err);
  }
});
