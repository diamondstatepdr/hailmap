"use client";

import { CloudHail, Tornado, Wind } from "lucide-react";
import { formatWhen, placeLabel, type ReportFilter } from "@/lib/filters";
import { hazardLabel, hazardOf, magnitudeLabel } from "@/lib/hazard";
import type { HailReport, SourceStatus } from "@/lib/types";

interface Props {
  loading: boolean;
  error: string | null;
  reports: HailReport[];
  filter: ReportFilter;
  status: SourceStatus | null;
  syncedAt: string | null;
  onSelect: (report: HailReport) => void;
}

export default function StormsPanel({ loading, error, reports, filter, status, syncedAt, onSelect }: Props) {
  return (
    <div className="page-enter h-full overflow-y-auto px-4 py-5 md:px-8">
      <header className="mb-5 max-w-3xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Live window</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Storms</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
          Official hail, wind, and tornado reports for the map window. Community photos stay labeled as community.
        </p>
      </header>
      {error ? <p className="mb-3 rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-muted">{error}</p> : null}
      {loading && !reports.length ? (
        <div aria-busy="true" className="max-w-3xl space-y-2">
          <span className="sr-only">Loading reports…</span>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton h-[4.4rem]" />
          ))}
        </div>
      ) : null}
      {!loading && !reports.length ? (
        <div className="empty-state max-w-xl">
          <CloudHail className="mx-auto mb-2 text-accent" size={28} />
          <p className="text-sm font-semibold text-ink">No reports match these filters.</p>
          <p className="mt-1 text-sm">Widen the time window or turn a hazard back on.</p>
        </div>
      ) : null}
      <ul className="grid max-w-3xl gap-2">
        {reports.slice(0, 300).map((report) => {
          const hazard = hazardOf(report.hazard);
          const Icon = hazard === "wind" ? Wind : hazard === "tornado" ? Tornado : CloudHail;
          return (
            <li key={report.id}>
              <button type="button" onClick={() => onSelect(report)} className="storm-card">
                <span className={`hazard-badge ${hazardClass(hazard)}`}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold tracking-tight">
                    {hazardLabel(hazard)} · {placeLabel(report)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {formatWhen(report.occurredAt)} · {report.confidence}
                    {report.photoUrl ? " · community photo" : ""}
                    {report.source === "seed" ? " · sample" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm font-semibold tracking-tight">{magnitudeLabel(report)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {loading && reports.length ? <p className="mt-3 text-xs text-muted">Updating reports…</p> : null}
      <div className="mt-6 flex max-w-3xl flex-wrap gap-2 text-xs text-muted">
        <Feed label="SPC" value={status?.spc ?? "checking"} />
        <Feed label="IEM" value={status?.iem ?? "checking"} />
        <Feed label="NWS" value={status?.nws ?? "checking"} />
        <Feed label="MESH" value={status?.mesh === "skipped" ? "off until HAILMAP_MESH_URL is set" : (status?.mesh ?? "checking")} />
        {syncedAt ? <span className="self-center">Updated {formatWhen(syncedAt)}</span> : null}
        {filter.state ? <span className="self-center">State {filter.state}</span> : null}
      </div>
    </div>
  );
}

function Feed({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-line bg-panel px-2.5 py-1">
      <span className="font-semibold text-ink">{label}</span> {value}
    </span>
  );
}

function hazardClass(hazard: string): string {
  if (hazard === "wind") return "hazard-wind";
  if (hazard === "tornado") return "hazard-tornado";
  return "hazard-hail";
}
