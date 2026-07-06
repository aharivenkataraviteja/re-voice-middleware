import { useToday, useUpdateTask, useLeads, useUpdateLead, useUsers } from "../api/hooks";
import { useUserNameLookup } from "../api/useUserName";
import { useAuth } from "../auth/AuthContext";
import type { Task } from "../api/types";
import "./TodaysWorkPage.css";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function MissedOpportunities({ tasks }: { tasks: Task[] }) {
  const { data: leadsData } = useLeads();
  const { data: usersData } = useUsers();
  const updateTask = useUpdateTask();
  const updateLead = useUpdateLead();

  if (tasks.length === 0) return null;

  return (
    <section className="today-section">
      <h2 className="section-label">Missed opportunities</h2>
      {tasks.map((task) => {
        const lead = leadsData?.leads.find((l) => l.id === task.leadId);
        return (
          <div key={task.id} className="priority-card missed-opp-card">
            <div className="priority-body">
              <div className="priority-title">{lead?.callerName || "Unknown caller"}</div>
              <div className="missed-opp-tags">
                <span>Wanted appointment</span>
                <span>·</span>
                <span>Calendar unavailable</span>
                <span>·</span>
                <span>{timeAgo(task.createdAt)}</span>
              </div>
              {!lead?.assignedAgentId && (
                <label className="missed-opp-assign">
                  Unassigned —
                  <select
                    value=""
                    onChange={(e) => {
                      if (task.leadId && e.target.value) {
                        updateLead.mutate({ id: task.leadId, patch: { assignedAgentId: e.target.value } });
                      }
                    }}
                  >
                    <option value="" disabled>
                      Assign to…
                    </option>
                    {usersData?.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName || u.email}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="missed-opp-actions">
              {lead?.phone && (
                <a className="tap-call" href={`tel:${lead.phone}`}>
                  Call Now
                </a>
              )}
              <button
                className="link-btn"
                onClick={() => updateTask.mutate({ id: task.id, patch: { status: "done" } })}
              >
                Mark handled
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function TodaysWorkPage() {
  const { data, isLoading, isError } = useToday();
  const { me } = useAuth();
  const updateTask = useUpdateTask();
  const userName = useUserNameLookup();
  const privileged = me?.role === "admin" || me?.role === "manager";

  if (isLoading) return <PageSkeleton />;
  if (isError || !data) return <ErrorState />;

  const missedOpportunityTasks = data.overdueTasks.filter((t) => t.source === "calendar_failure");
  const otherOverdueTasks = data.overdueTasks.filter((t) => t.source !== "calendar_failure");

  return (
    <div className="today-page">
      <h1 className="page-title">Today&apos;s Work</h1>

      {privileged && data.dollarMetrics && (
        <div className="money-row">
          <div className="money-cell">
            <div className="money-label">
              Potential commission pipeline <span className="est-tag">estimate</span>
            </div>
            <div className="money-value">
              ${data.dollarMetrics.potentialCommissionPipelineUsd.toLocaleString()}
            </div>
          </div>
          <div className="money-cell">
            <div className="money-label">
              Estimated transaction volume <span className="est-tag">estimate</span>
            </div>
            <div className="money-value">
              ${data.dollarMetrics.estimatedTransactionVolumeUsd.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      <MissedOpportunities tasks={missedOpportunityTasks} />

      {data.hotLeads.length > 0 && (
        <section className="today-section">
          <h2 className="section-label">Call immediately</h2>
          {data.hotLeads.map((lead) => (
            <div key={lead.id} className="priority-card">
              <div className="priority-body">
                <div className="priority-title">{lead.callerName || "Unnamed lead"}</div>
                <div className="priority-sub">
                  {lead.intent || "Unknown intent"}
                  {privileged && ` · ${userName(lead.assignedAgentId)}`}
                </div>
              </div>
              {lead.phone && (
                <a className="tap-call" href={`tel:${lead.phone}`}>
                  Call
                </a>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="today-section">
        <h2 className="section-label">Today&apos;s appointments</h2>
        {data.todaysAppointments.length === 0 ? (
          <EmptyState text="No appointments scheduled for today." />
        ) : (
          data.todaysAppointments.map((appt) => (
            <div key={appt.id} className="row-card">
              <div className="row-title">
                {formatTime(appt.slotStart)} — {appt.appointmentType || "Appointment"}
              </div>
              <div className="row-sub">{appt.format || ""}</div>
            </div>
          ))
        )}
      </section>

      <section className="today-section">
        <h2 className="section-label">Follow-ups</h2>
        {otherOverdueTasks.length === 0 ? (
          <EmptyState text="No overdue follow-ups — you're caught up." />
        ) : (
          otherOverdueTasks.map((task) => (
            <div key={task.id} className="row-card">
              <div className="row-title">{task.title}</div>
              <div className="row-actions">
                <button
                  className="link-btn"
                  onClick={() => updateTask.mutate({ id: task.id, patch: { status: "done" } })}
                >
                  Mark done
                </button>
                <button
                  className="link-btn"
                  onClick={() => updateTask.mutate({ id: task.id, patch: { status: "snoozed" } })}
                >
                  Snooze
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function ErrorState() {
  return <div className="empty-state error">Couldn&apos;t load Today&apos;s Work. Please try again.</div>;
}

function PageSkeleton() {
  return (
    <div className="today-page">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
      <div className="skeleton skeleton-row" />
    </div>
  );
}
