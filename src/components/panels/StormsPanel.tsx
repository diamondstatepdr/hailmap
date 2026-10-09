"use client";

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
    <div className="h-full overflow-y-auto px-4 py-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Storms</h1>
        <p className="text-sm text-muted">Official hail, wind, and tornado reports for the map window. Community photos stay labeled as community.</p>
      </header>
      {loading ? <p className="text-sm text-muted">Loading reports…</p> : null}
      {error ? <p className="rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-muted">{error}</p> : null}
      {!loading && !reports.length ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          No reports match these filters.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {reports.slice(0, 300).map((report) => (
          <li key={report.id}>
            <button type="button" onClick={() => onSelect(report)} className="flex w-full items-start justify-between gap-3 py-3 text-left">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {hazardLabel(hazardOf(report.hazard))} · {placeLabel(report)}
                </span>
                <span className="block text-xs text-muted">
                  {formatWhen(report.occurredAt)} · {report.confidence}
                  {report.photoUrl ? " · community photo" : ""}
                  {report.source === "seed" ? " · sample" : ""}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold">{magnitudeLabel(report)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-2 text-xs text-muted">
        <span className="rounded-full border border-line px-2 py-1">SPC {status?.spc ?? "checking"}</span>
        <span className="rounded-full border border-line px-2 py-1">IEM {status?.iem ?? "checking"}</span>
        <span className="rounded-full border border-line px-2 py-1">NWS {status?.nws ?? "checking"}</span>
        <span className="rounded-full border border-line px-2 py-1">
          MESH {status?.mesh === "skipped" ? "off until HAILMAP_MESH_URL is set" : (status?.mesh ?? "checking")}
        </span>
        {syncedAt ? <span>Updated {formatWhen(syncedAt)}</span> : null}
        {filter.state ? <span>State {filter.state}</span> : null}
      </div>
    </div>
  );
}
