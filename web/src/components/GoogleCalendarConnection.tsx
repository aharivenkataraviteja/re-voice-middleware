import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useGoogleCalendarStatus,
  useGoogleCalendarTeamStatus,
  useDisconnectGoogleCalendar,
} from "../api/hooks";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./GoogleCalendarConnection.css";

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Google sign-in was cancelled or access was denied.",
  missing_params: "Something went wrong on the way back from Google — please try connecting again.",
  invalid_state: "That connection link expired — please click Connect Google Calendar again.",
  token_exchange_failed: "Google couldn't be reached to finish connecting — please try again.",
};

export function GoogleCalendarConnection() {
  const { me } = useAuth();
  const privileged = me?.role === "admin" || me?.role === "manager";
  const [searchParams, setSearchParams] = useSearchParams();
  const [connecting, setConnecting] = useState(false);
  const { data: status, isLoading } = useGoogleCalendarStatus();
  const { data: teamStatus } = useGoogleCalendarTeamStatus(privileged);
  const disconnect = useDisconnectGoogleCalendar();

  const googleParam = searchParams.get("google");
  const reason = searchParams.get("reason");

  useEffect(() => {
    if (googleParam) {
      // Clear the query params after reading them once, so a page refresh
      // doesn't keep re-showing the same banner.
      const next = new URLSearchParams(searchParams);
      next.delete("google");
      next.delete("reason");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const { url } = await api.get<{ url: string }>("/api/v1/integrations/google-calendar/connect");
      window.location.href = url;
    } catch {
      setConnecting(false);
    }
  }

  return (
    <section className="gcal-section">
      {googleParam === "connected" && (
        <div className="gcal-banner gcal-banner-success">Google Calendar connected successfully.</div>
      )}
      {googleParam === "error" && (
        <div className="gcal-banner gcal-banner-error">
          {ERROR_MESSAGES[reason ?? ""] || "Couldn't connect Google Calendar — please try again."}
        </div>
      )}

      <div className="gcal-own-status">
        {isLoading ? (
          <div className="skeleton skeleton-row" />
        ) : status?.connected ? (
          <>
            <span className="status-chip status-completed">Connected</span>
            <span className="gcal-email">{status.googleAccountEmail}</span>
            <button className="link-btn" onClick={() => disconnect.mutate()}>
              Disconnect
            </button>
          </>
        ) : status?.status === "error" ? (
          <>
            <span className="status-chip status-no_show">Needs reconnect</span>
            <button className="gcal-connect-btn" onClick={handleConnect} disabled={connecting}>
              {connecting ? "Redirecting…" : "Reconnect Google Calendar"}
            </button>
          </>
        ) : (
          <button className="gcal-connect-btn" onClick={handleConnect} disabled={connecting}>
            {connecting ? "Redirecting…" : "Connect Google Calendar"}
          </button>
        )}
      </div>

      {privileged && teamStatus && teamStatus.agents.length > 0 && (
        <div className="gcal-team">
          <h3 className="section-label">Team calendar connections</h3>
          <table className="gcal-team-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Status</th>
                <th>Google account</th>
              </tr>
            </thead>
            <tbody>
              {teamStatus.agents.map((a) => (
                <tr key={a.agentId}>
                  <td>{a.agentName || a.agentEmail}</td>
                  <td>
                    <span
                      className={`status-chip ${
                        a.status === "connected"
                          ? "status-completed"
                          : a.status === "error"
                            ? "status-no_show"
                            : ""
                      }`}
                    >
                      {a.status === "connected" ? "Connected" : a.status === "error" ? "Needs reconnect" : "Not connected"}
                    </span>
                  </td>
                  <td>{a.googleAccountEmail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
