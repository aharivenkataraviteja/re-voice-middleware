import { Link } from "react-router-dom";
import { useLead, useUpdateLead, useUsers } from "../api/hooks";
import type { LeadStage } from "../api/types";
import { PlayRecordingToggle } from "./CallRecording";
import "./LeadDetailPanel.css";

const STAGES: LeadStage[] = ["hot", "warm", "cold", "past_client"];
const TIMELINE_STAGES = ["called", "appointment_booked", "showing", "offer", "inspection", "closed"] as const;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function LeadDetailPanel({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { data, isLoading } = useLead(leadId);
  const { data: usersData } = useUsers();
  const updateLead = useUpdateLead();

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {isLoading || !data ? (
          <div>Loading…</div>
        ) : (
          <>
            <h2 className="detail-name">{data.lead.callerName || "Unnamed lead"}</h2>

            {(() => {
              const { lead, calls, appointments } = data;
              const assignedAgent = usersData?.users.find((u) => u.id === lead.assignedAgentId);
              // calls is already ordered most-recent-first by the API; the most
              // recent call or timeline event (whichever is later) is "last interaction."
              const lastCallAt = calls[0]?.startedAt ?? null;
              const lastTimelineAt = data.timeline.length ? data.timeline[data.timeline.length - 1].eventDate : null;
              const lastInteraction = [lastCallAt, lastTimelineAt]
                .filter((d): d is string => Boolean(d))
                .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
              const now = Date.now();
              const upcomingAppt = appointments
                .filter((a) => a.status === "confirmed" && new Date(a.slotStart).getTime() > now)
                .sort((a, b) => new Date(a.slotStart).getTime() - new Date(b.slotStart).getTime())[0];
              // Not a captured preference (nothing in the current call flow asks
              // the caller to choose) — derived from what contact info exists.
              const preferredContact = lead.phone ? "Phone" : lead.email ? "Email" : "Not specified";

              return (
                <div className="detail-contact">
                  <div className="detail-contact-item">
                    <span className="detail-contact-label">Phone</span>
                    <span className={lead.phone ? "detail-contact-value" : "detail-contact-value muted"}>
                      {lead.phone || "Not collected"}
                    </span>
                  </div>
                  <div className="detail-contact-item">
                    <span className="detail-contact-label">Email</span>
                    <span className={lead.email ? "detail-contact-value" : "detail-contact-value muted"}>
                      {lead.email || "Not collected"}
                    </span>
                  </div>
                  <div className="detail-contact-item">
                    <span className="detail-contact-label">Preferred contact</span>
                    <span className={preferredContact === "Not specified" ? "detail-contact-value muted" : "detail-contact-value"}>
                      {preferredContact}
                    </span>
                  </div>
                  <div className="detail-contact-item">
                    <span className="detail-contact-label">Last interaction</span>
                    <span className={lastInteraction ? "detail-contact-value" : "detail-contact-value muted"}>
                      {lastInteraction ? formatDateTime(lastInteraction) : "None yet"}
                    </span>
                  </div>
                  <div className="detail-contact-item">
                    <span className="detail-contact-label">Upcoming appointment</span>
                    <span className={upcomingAppt ? "detail-contact-value" : "detail-contact-value muted"}>
                      {upcomingAppt
                        ? `${formatDateTime(upcomingAppt.slotStart)}${upcomingAppt.appointmentType ? ` — ${upcomingAppt.appointmentType.replace(/_/g, " ")}` : ""}`
                        : "None scheduled"}
                    </span>
                  </div>
                  <div className="detail-contact-item">
                    <span className="detail-contact-label">Assigned agent</span>
                    <span className={assignedAgent ? "detail-contact-value" : "detail-contact-value muted"}>
                      {assignedAgent ? assignedAgent.fullName || assignedAgent.email : "Unassigned"}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="detail-controls">
              <label className="detail-field">
                <span>Stage</span>
                <select
                  value={data.lead.stage}
                  onChange={(e) =>
                    updateLead.mutate({ id: leadId, patch: { stage: e.target.value as LeadStage } })
                  }
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>

              <label className="detail-field">
                <span>Assigned to</span>
                <select
                  value={data.lead.assignedAgentId ?? ""}
                  onChange={(e) =>
                    updateLead.mutate({
                      id: leadId,
                      patch: { assignedAgentId: e.target.value || null },
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {usersData?.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName || u.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <h3 className="detail-section-title">Client Timeline</h3>
            <div className="timeline">
              {TIMELINE_STAGES.map((stageType) => {
                const event = data.timeline.find((t) => t.eventType === stageType);
                return (
                  <div key={stageType} className={event ? "t-node" : "t-node pending"}>
                    <div className="t-date">{event ? formatDate(event.eventDate) : "—"}</div>
                    <div className="t-label">{stageType.replace("_", " ")}</div>
                  </div>
                );
              })}
            </div>

            <h3 className="detail-section-title">Calls</h3>
            {data.calls.length === 0 ? (
              <div className="empty-state">No calls yet.</div>
            ) : (
              data.calls.map((call) => (
                <div key={call.id} className="call-row">
                  <div className="call-row-top">
                    <div>{call.summaryText || "No summary available"}</div>
                    <Link to={`/calls/${call.id}`}>View details</Link>
                  </div>
                  <PlayRecordingToggle call={call} />
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
