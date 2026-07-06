export type Role = "admin" | "manager" | "agent";
export type LeadStage = "hot" | "warm" | "cold" | "past_client";
export type TaskStatus = "open" | "done" | "snoozed";
export type AppointmentStatus = "confirmed" | "completed" | "no_show" | "cancelled";

export interface Me {
  userId: string;
  tenantId: string;
  role: Role;
  fullName: string | null;
}

export interface User {
  id: string;
  fullName: string | null;
  email: string;
  role: Role;
}

export interface Lead {
  id: string;
  tenantId: string;
  callerName: string | null;
  phone: string | null;
  email: string | null;
  intent: string | null;
  stage: LeadStage;
  scoreBi: string;
  scoreSi: string;
  scoreFr: string;
  scoreUs: string;
  scoreTs: string;
  scoreMc: string;
  scoreRf: string;
  scoreComposite: string;
  nurtureTier: string | null;
  assignedAgentId: string | null;
  status: string;
  budgetFloor: string | null;
  budgetCeiling: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  leadId: string;
  eventType: "called" | "appointment_booked" | "showing" | "offer" | "inspection" | "closed";
  eventDate: string;
  source: "ai" | "agent" | "crm_sync";
  notes: string | null;
}

export interface Call {
  id: string;
  leadId: string | null;
  vapiCallId: string;
  durationSeconds: number | null;
  outcome: string | null;
  objectionType: string | null;
  sentiment: string | null;
  recordingUrl: string | null;
  stereoRecordingUrl: string | null;
  transcriptText: string | null;
  summaryText: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Appointment {
  id: string;
  leadId: string | null;
  agentId: string | null;
  slotStart: string;
  appointmentType: string | null;
  format: string | null;
  status: AppointmentStatus;
  notes: string | null;
}

export interface Task {
  id: string;
  tenantId: string;
  assigneeId: string | null;
  leadId: string | null;
  title: string;
  source: "call" | "manual" | "calendar_failure";
  dueDate: string | null;
  status: TaskStatus;
  createdAt: string;
}

export interface TodayResponse {
  overdueTasks: Task[];
  todaysAppointments: Appointment[];
  hotLeads: Lead[];
  dollarMetrics: { potentialCommissionPipelineUsd: number; estimatedTransactionVolumeUsd: number } | null;
  dollarMetricsAreEstimates?: boolean;
}

export interface LeadDetail {
  lead: Lead;
  timeline: TimelineEvent[];
  calls: Call[];
  appointments: Appointment[];
}

export type LeadsResponse = { leads: Lead[]; total: number; hasMore: boolean };
export type TasksResponse = { tasks: Task[]; total: number; hasMore: boolean };
export type AppointmentsResponse = { appointments: Appointment[]; total: number; hasMore: boolean };
export type UsersResponse = { users: User[] };
export type CallsResponse = { calls: Call[]; total: number; hasMore: boolean };

export interface AnalyticsSummary {
  totalCalls: number;
  totalAppointments: number;
  leadsByStage: Record<string, number>;
  objectionsByType: Record<string, number>;
  avgCallDurationSeconds: number | null;
}

export interface LeaderboardRow {
  agentId: string | null;
  appointmentCount: number;
}

export interface CoachNote {
  id: string;
  tenantId: string;
  weekStart: string;
  content: string;
  metrics: unknown;
  approved: boolean;
  generatedBy: "llm" | "template";
  createdAt: string;
}
