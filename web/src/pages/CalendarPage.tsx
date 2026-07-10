import { useMemo } from "react";
import { useAppointments, useLeads, useUpdateAppointment } from "../api/hooks";
import { useUserNameLookup } from "../api/useUserName";
import { useAuth } from "../auth/AuthContext";
import { GoogleCalendarConnection } from "../components/GoogleCalendarConnection";
import type { Appointment, AppointmentStatus } from "../api/types";
import "./CalendarPage.css";

const DAYS_AHEAD = 7;

function dayKey(iso: string) {
  return new Date(iso).toDateString();
}

function dayLabel(date: Date, isToday: boolean) {
  const label = date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  return isToday ? `${label} — Today` : label;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatLabel(raw: string) {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  confirmed: "Confirmed",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

export function CalendarPage() {
  const { me } = useAuth();
  const privileged = me?.role === "admin" || me?.role === "manager";

  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + DAYS_AHEAD);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const { data, isLoading, isError } = useAppointments(range);
  const { data: leadsData } = useLeads();
  const userName = useUserNameLookup();
  const updateAppointment = useUpdateAppointment();

  const leadName = (leadId: string | null) => {
    if (!leadId) return "No linked lead";
    const lead = leadsData?.leads.find((l) => l.id === leadId);
    return lead?.callerName || "Unnamed lead";
  };

  if (isLoading) return <div className="calendar-page">Loading calendar…</div>;
  if (isError || !data) return <div className="calendar-page empty-state error">Couldn&apos;t load appointments.</div>;

  const days: { date: Date; appts: Appointment[] }[] = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + i);
    days.push({ date, appts: [] });
  }
  for (const appt of data.appointments) {
    const key = dayKey(appt.slotStart);
    const bucket = days.find((d) => d.date.toDateString() === key);
    if (bucket) bucket.appts.push(appt);
  }

  return (
    <div className="calendar-page">
      <h1 className="page-title">Calendar</h1>

      <GoogleCalendarConnection />

      {days.map(({ date, appts }, i) => (
        <section className="calendar-day" key={date.toISOString()}>
          <h2 className="section-label">{dayLabel(date, i === 0)}</h2>
          {appts.length === 0 ? (
            <div className="empty-state">No appointments scheduled.</div>
          ) : (
            appts.map((appt) => (
              <div className="appt-row" key={appt.id}>
                <div className="appt-time">{formatTime(appt.slotStart)}</div>
                <div className="appt-body">
                  <div className="appt-title">
                    {appt.appointmentType || "Appointment"}
                    {appt.format && <span className="appt-format"> · {formatLabel(appt.format)}</span>}
                  </div>
                  <div className="appt-sub">
                    {leadName(appt.leadId)}
                    {privileged && ` · ${userName(appt.agentId)}`}
                  </div>
                </div>
                <div className="appt-status-col">
                  <span className={`status-chip status-${appt.status}`}>{STATUS_LABEL[appt.status]}</span>
                  {appt.status === "confirmed" && (
                    <div className="row-actions">
                      <button
                        className="link-btn"
                        onClick={() => updateAppointment.mutate({ id: appt.id, patch: { status: "completed" } })}
                      >
                        Completed
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => updateAppointment.mutate({ id: appt.id, patch: { status: "no_show" } })}
                      >
                        No-show
                      </button>
                      <button
                        className="link-btn"
                        onClick={() => updateAppointment.mutate({ id: appt.id, patch: { status: "cancelled" } })}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
