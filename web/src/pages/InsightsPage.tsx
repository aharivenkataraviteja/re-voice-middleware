import {
  useAnalyticsSummary,
  useLeaderboard,
  useCoachNote,
  useGenerateCoachNote,
  useApproveCoachNote,
  useCalls,
} from "../api/hooks";
import { useUserNameLookup } from "../api/useUserName";
import { useAuth } from "../auth/AuthContext";
import "./InsightsPage.css";

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatLabel(raw: string) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function AnalyticsSection() {
  const { data, isLoading, isError } = useAnalyticsSummary();
  const { data: leaderboardData } = useLeaderboard();
  const userName = useUserNameLookup();

  if (isLoading) return <div className="skeleton skeleton-row" />;
  if (isError || !data) return <div className="empty-state error">Couldn&apos;t load analytics.</div>;

  const { summary } = data;
  const stageEntries = Object.entries(summary.leadsByStage);
  const objectionEntries = Object.entries(summary.objectionsByType);
  const leaderboard = [...(leaderboardData?.leaderboard ?? [])].sort(
    (a, b) => b.appointmentCount - a.appointmentCount
  );

  return (
    <>
      <section className="insights-section">
        <h2 className="section-label">This week at a glance</h2>
        <div className="stat-tiles">
          <div className="stat-tile">
            <div className="stat-value">{summary.totalCalls}</div>
            <div className="stat-label">Total calls</div>
          </div>
          <div className="stat-tile">
            <div className="stat-value">{summary.totalAppointments}</div>
            <div className="stat-label">Appointments booked</div>
          </div>
          <div className="stat-tile">
            <div className="stat-value">{formatDuration(summary.avgCallDurationSeconds)}</div>
            <div className="stat-label">Avg. call duration</div>
          </div>
        </div>
      </section>

      <section className="insights-section">
        <h2 className="section-label">Pipeline breakdown</h2>
        {stageEntries.length === 0 ? (
          <div className="empty-state">No leads yet.</div>
        ) : (
          <div className="breakdown-list">
            {stageEntries.map(([stage, count]) => (
              <div className="breakdown-row" key={stage}>
                <span className="breakdown-label">{formatLabel(stage)}</span>
                <span className="breakdown-count">{count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="insights-section">
        <h2 className="section-label">Objections raised</h2>
        {objectionEntries.length === 0 ? (
          <div className="empty-state">No objections logged.</div>
        ) : (
          <div className="breakdown-list">
            {objectionEntries.map(([type, count]) => (
              <div className="breakdown-row" key={type}>
                <span className="breakdown-label">{formatLabel(type)}</span>
                <span className="breakdown-count">{count}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="insights-section">
        <h2 className="section-label">Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <div className="empty-state">No appointments booked yet.</div>
        ) : (
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Appointments</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <tr key={row.agentId ?? i}>
                  <td>{userName(row.agentId)}</td>
                  <td className="num">{row.appointmentCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function CoachNoteSection({ isAdmin }: { isAdmin: boolean }) {
  const { data, isLoading } = useCoachNote();
  const generate = useGenerateCoachNote();
  const approve = useApproveCoachNote();

  const note = data?.note ?? null;

  return (
    <section className="insights-section">
      <h2 className="section-label">AI Coach note</h2>
      {isLoading ? (
        <div className="skeleton skeleton-row" />
      ) : !note ? (
        <div className="empty-state">
          No coach note yet this week.
          {isAdmin && (
            <button className="link-btn" style={{ marginLeft: "0.6rem" }} onClick={() => generate.mutate()}>
              {generate.isPending ? "Generating…" : "Generate note"}
            </button>
          )}
        </div>
      ) : (
        <div className="coach-note-card">
          <div className="coach-note-meta">
            Week of {new Date(note.weekStart).toLocaleDateString()}
            {note.approved ? (
              <span className="status-chip status-completed" style={{ marginLeft: "0.6rem" }}>
                Approved
              </span>
            ) : (
              <span className="status-chip status-no_show" style={{ marginLeft: "0.6rem" }}>
                Pending approval
              </span>
            )}
          </div>
          <p className="coach-note-content">{note.content}</p>
          {isAdmin && (
            <div className="row-actions">
              {!note.approved && (
                <button className="link-btn" onClick={() => approve.mutate(note.id)}>
                  Approve
                </button>
              )}
              <button className="link-btn" onClick={() => generate.mutate()}>
                {generate.isPending ? "Regenerating…" : "Regenerate"}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CallsSection() {
  const { data, isLoading, isError } = useCalls({ limit: 20 });

  if (isLoading) return <div className="skeleton skeleton-row" />;
  if (isError || !data) return <div className="empty-state error">Couldn&apos;t load calls.</div>;

  return (
    <section className="insights-section">
      <h2 className="section-label">Recent calls &amp; recordings</h2>
      {data.calls.length === 0 ? (
        <div className="empty-state">No calls recorded yet.</div>
      ) : (
        <div className="calls-list">
          {data.calls.map((call) => (
            <div className="call-row" key={call.id}>
              <div className="call-time">
                {call.startedAt ? new Date(call.startedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—"}
              </div>
              <div className="call-body">
                <div className="call-title">
                  {call.outcome ? formatLabel(call.outcome) : "Call"}
                  {call.sentiment && <span className="call-sentiment"> · {formatLabel(call.sentiment)}</span>}
                </div>
                {call.summaryText && <div className="call-summary">{call.summaryText}</div>}
              </div>
              <div className="call-side">
                <div className="call-duration">{formatDuration(call.durationSeconds)}</div>
                {call.recordingUrl && (
                  <a className="link-btn" href={call.recordingUrl} target="_blank" rel="noreferrer">
                    Recording
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function InsightsPage() {
  const { me } = useAuth();
  const privileged = me?.role === "admin" || me?.role === "manager";
  const isAdmin = me?.role === "admin";

  return (
    <div className="insights-page">
      <h1 className="page-title">Insights</h1>

      {privileged ? (
        <>
          <AnalyticsSection />
          <CoachNoteSection isAdmin={isAdmin} />
        </>
      ) : (
        <div className="empty-state">Brokerage-wide analytics are visible to managers and admins.</div>
      )}

      <CallsSection />
    </div>
  );
}
