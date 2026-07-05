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
            <div className="detail-meta">{data.lead.phone || data.lead.email || "No contact info"}</div>

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
