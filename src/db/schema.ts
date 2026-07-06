import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  boolean,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "manager", "agent"]);
export const leadStageEnum = pgEnum("lead_stage", ["hot", "warm", "cold", "past_client"]);
export const taskSourceEnum = pgEnum("task_source", ["call", "manual", "calendar_failure"]);
export const taskStatusEnum = pgEnum("task_status", ["open", "done", "snoozed"]);
export const timelineEventTypeEnum = pgEnum("timeline_event_type", [
  "called",
  "appointment_booked",
  "showing",
  "offer",
  "inspection",
  "closed",
]);
export const timelineSourceEnum = pgEnum("timeline_source", ["ai", "agent", "crm_sync"]);
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "confirmed",
  "completed",
  "no_show",
  "cancelled",
]);

// Single-tenant for Release 1.0 (Luxury Partners Realty) — every table is
// tenant_id-scoped from day one so onboarding a second brokerage later is a
// data-migration, not a schema rewrite. See tenant_schema.json for the
// eventual multi-tenant target state; this is the right-sized v1 subset of it.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  brokerageName: text("brokerage_name").notNull(),
  subdomain: text("subdomain").notNull(),
  status: text("status").notNull().default("active"),
  planTier: text("plan_tier").notNull().default("starter"),
  primaryContactEmail: text("primary_contact_email").notNull(),
  // Small, free-form settings bag (availability/business-hours for now) so
  // Calendar's "set availability" action has somewhere real to persist to,
  // without a dedicated table for what is currently a single small object.
  settings: jsonb("settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("agent"),
    fullName: text("full_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
    tenantIdx: index("users_tenant_idx").on(table.tenantId),
  })
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    callerName: text("caller_name"),
    phone: text("phone"),
    email: text("email"),
    intent: text("intent"),
    stage: leadStageEnum("stage").notNull().default("warm"),
    scoreBi: numeric("score_bi").notNull().default("3"),
    scoreSi: numeric("score_si").notNull().default("3"),
    scoreFr: numeric("score_fr").notNull().default("3"),
    scoreUs: numeric("score_us").notNull().default("3"),
    scoreTs: numeric("score_ts").notNull().default("5"),
    scoreMc: numeric("score_mc").notNull().default("3"),
    scoreRf: numeric("score_rf").notNull().default("0"),
    scoreComposite: numeric("score_composite").notNull().default("3"),
    budgetFloor: numeric("budget_floor"),
    budgetCeiling: numeric("budget_ceiling"),
    nurtureTier: text("nurture_tier"),
    assignedAgentId: uuid("assigned_agent_id").references(() => users.id),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantStageIdx: index("leads_tenant_stage_idx").on(table.tenantId, table.stage),
    tenantAgentIdx: index("leads_tenant_agent_idx").on(table.tenantId, table.assignedAgentId),
  })
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    leadId: uuid("lead_id").references(() => leads.id),
    vapiCallId: text("vapi_call_id").notNull(),
    durationSeconds: integer("duration_seconds"),
    outcome: text("outcome"),
    endedReason: text("ended_reason"),
    objectionType: text("objection_type"),
    sentiment: text("sentiment"),
    recordingUrl: text("recording_url"),
    stereoRecordingUrl: text("stereo_recording_url"),
    transcriptText: text("transcript_text"),
    summaryText: text("summary_text"),
    structuredData: jsonb("structured_data"),
    costUsd: numeric("cost_usd"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => ({
    tenantStartedIdx: index("calls_tenant_started_idx").on(table.tenantId, table.startedAt),
    vapiCallIdUnique: uniqueIndex("calls_vapi_call_id_unique").on(table.vapiCallId),
  })
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    leadId: uuid("lead_id").references(() => leads.id),
    agentId: uuid("agent_id").references(() => users.id),
    slotStart: timestamp("slot_start", { withTimezone: true }).notNull(),
    appointmentType: text("appointment_type"),
    format: text("format"),
    status: appointmentStatusEnum("status").notNull().default("confirmed"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantSlotIdx: index("appointments_tenant_slot_idx").on(table.tenantId, table.slotStart),
  })
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    assigneeId: uuid("assignee_id").references(() => users.id),
    leadId: uuid("lead_id").references(() => leads.id),
    title: text("title").notNull(),
    source: taskSourceEnum("source").notNull().default("manual"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: taskStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    assigneeDueIdx: index("tasks_assignee_due_idx").on(table.assigneeId, table.dueDate, table.status),
  })
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    leadId: uuid("lead_id").notNull().references(() => leads.id),
    eventType: timelineEventTypeEnum("event_type").notNull(),
    eventDate: timestamp("event_date", { withTimezone: true }).notNull().defaultNow(),
    source: timelineSourceEnum("source").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    leadIdx: index("timeline_events_lead_idx").on(table.leadId),
  })
);

export const smsLog = pgTable(
  "sms_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    leadId: uuid("lead_id").references(() => leads.id),
    sessionId: text("session_id").notNull(),
    toNumberRedacted: text("to_number_redacted").notNull(),
    templateId: text("template_id").notNull(),
    sent: boolean("sent").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index("sms_log_session_idx").on(table.sessionId),
  })
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    resource: text("resource"),
    ip: text("ip"),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index("audit_log_tenant_created_idx").on(table.tenantId, table.createdAt),
  })
);

export const coachNotes = pgTable(
  "coach_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
    content: text("content").notNull(),
    metrics: jsonb("metrics"),
    approved: boolean("approved").notNull().default(false),
    generatedBy: text("generated_by").notNull().default("template"), // "llm" | "template"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantWeekIdx: index("coach_notes_tenant_week_idx").on(table.tenantId, table.weekStart),
  })
);

// Schema ready ahead of any real connector — see middleware_rules.json /
// tenant_schema.json for the eventual live CRM sync (backlog, not Release 1.0).
export const crmSyncStatus = pgTable("crm_sync_status", {
  leadId: uuid("lead_id").primaryKey().references(() => leads.id),
  externalCrm: text("external_crm"),
  externalId: text("external_id"),
  syncStatus: text("sync_status").notNull().default("not_connected"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});
