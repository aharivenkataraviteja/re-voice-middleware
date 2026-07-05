import { useParams, Link } from "react-router-dom";
import { useCall } from "../api/hooks";
import { RecordingPlayer } from "../components/CallRecording";
import { ApiError } from "../api/client";
import "./CallDetailPage.css";

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatLabel(raw: string) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CallDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useCall(id ?? null);

  if (isLoading) return <div className="call-detail-page">Loading call…</div>;

  if (error) {
    const forbidden = error instanceof ApiError && error.status === 403;
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="call-detail-page">
        <Link className="link-btn" to="/insights">
          ← Back to Insights
        </Link>
        <div className="empty-state error" style={{ marginTop: "1rem" }}>
          {forbidden
            ? "You don't have access to this call."
            : notFound
              ? "Call not found."
              : "Couldn't load this call."}
        </div>
      </div>
    );
  }

  const call = data?.call;
  if (!call) return null;

  return (
    <div className="call-detail-page">
      <Link className="link-btn" to="/insights">
        ← Back to Insights
      </Link>

      <h1 className="page-title" style={{ marginTop: "0.8rem" }}>
        {call.outcome ? formatLabel(call.outcome) : "Call"}
      </h1>

      <div className="call-detail-meta">
        <span>{call.startedAt ? new Date(call.startedAt).toLocaleString() : "Unknown time"}</span>
        <span>·</span>
        <span>{formatDuration(call.durationSeconds)}</span>
        {call.sentiment && (
          <>
            <span>·</span>
            <span>{formatLabel(call.sentiment)}</span>
          </>
        )}
      </div>

      {call.summaryText && <p className="call-detail-summary">{call.summaryText}</p>}

      <h2 className="section-label" style={{ marginTop: "1.5rem" }}>
        Recording &amp; transcript
      </h2>
      <RecordingPlayer call={call} />
    </div>
  );
}
