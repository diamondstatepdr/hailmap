"use client";

import { useEffect, useState } from "react";
import { sheetsCreateUrl, type LeadRow } from "@/lib/leads";

interface Props {
  signedIn: boolean;
  onSignIn: () => void;
}

export default function LeadsExport({ signedIn, onSignIn }: Props) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setLeads([]);
      return;
    }
    let cancelled = false;
    void fetch("/api/leads")
      .then(async (response) => {
        const payload = (await response.json()) as { leads?: LeadRow[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load leads");
        if (!cancelled) setLeads(payload.leads ?? []);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load leads");
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function download(format: "csv" | "sheets") {
    setError(null);
    const response = await fetch(`/api/leads?format=${format}`);
    if (!response.ok) {
      setError("Could not export leads");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = format === "sheets" ? "swathline-leads-sheets.csv" : "swathline-leads.csv";
    link.click();
    URL.revokeObjectURL(url);
    if (format === "sheets") window.open(sheetsCreateUrl(), "_blank", "noopener");
  }

  return (
    <section className="leads-card" data-leads>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Canvass leads</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight">Interested and signed</h2>
      <p className="mt-1 text-sm text-muted">This team only. Knocked and not-home houses stay off the export.</p>
      {signedIn ? (
        <>
          {leads.length ? (
            <ul className="leads-list">
              {leads.map((lead) => (
                <li key={`${lead.address}-${lead.date}`}>
                  <span className="block font-semibold">{lead.address}</span>
                  <span className="block text-xs text-muted">
                    {lead.status === "signed" ? "Signed" : "Interested"} · {lead.rep} · {lead.date}
                    {lead.hailIn != null ? ` · ${lead.hailIn.toFixed(2)} in` : ""}
                  </span>
                  {lead.note ? <span className="block text-xs">{lead.note}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No interested or signed houses yet.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary press" data-leads-csv onClick={() => void download("csv")}>
              Download CSV
            </button>
            <button type="button" className="btn btn-secondary press" data-leads-sheets onClick={() => void download("sheets")}>
              Open in Google Sheets
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn btn-primary press mt-3" onClick={onSignIn}>
          Sign in to export
        </button>
      )}
      {error ? <p className="mt-2 text-sm text-muted">{error}</p> : null}
    </section>
  );
}
