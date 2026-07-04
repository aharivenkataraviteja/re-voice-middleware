import { useState } from "react";
import { useLeads } from "../api/hooks";
import { useUserNameLookup } from "../api/useUserName";
import { LeadDetailPanel } from "../components/LeadDetailPanel";
import type { Lead, LeadStage } from "../api/types";
import "./PipelinePage.css";

const COLUMNS: { key: LeadStage; label: string }[] = [
  { key: "hot", label: "Hot" },
  { key: "warm", label: "Warm" },
  { key: "cold", label: "Cold" },
  { key: "past_client", label: "Past Clients" },
];

export function PipelinePage() {
  const { data, isLoading, isError } = useLeads();
  const userName = useUserNameLookup();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  if (isLoading) return <div className="pipeline-page">Loading pipeline…</div>;
  if (isError || !data) return <div className="pipeline-page empty-state error">Couldn&apos;t load leads.</div>;

  const byStage: Record<LeadStage, Lead[]> = { hot: [], warm: [], cold: [], past_client: [] };
  for (const lead of data.leads) byStage[lead.stage].push(lead);

  return (
    <div className="pipeline-page">
      <h1 className="page-title">Pipeline</h1>
      <div className="board">
        {COLUMNS.map((col) => (
          <div className="board-column" key={col.key}>
            <div className="column-header">
              {col.label} <span className="column-count">{byStage[col.key].length}</span>
            </div>
            {byStage[col.key].length === 0 ? (
              <div className="empty-state">No leads</div>
            ) : (
              byStage[col.key].map((lead) => (
                <button
                  key={lead.id}
                  className="lead-card"
                  onClick={() => setSelectedLeadId(lead.id)}
                >
                  <div className="lead-name">{lead.callerName || "Unnamed lead"}</div>
                  <div className="lead-meta">
                    {lead.intent || "—"} · {userName(lead.assignedAgentId)}
                  </div>
                </button>
              ))
            )}
          </div>
        ))}
      </div>

      {selectedLeadId && (
        <LeadDetailPanel leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      )}
    </div>
  );
}
