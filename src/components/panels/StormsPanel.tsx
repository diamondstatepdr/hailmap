"use client";

import { CloudHail, Tornado, Wind } from "lucide-react";
import { ChaseSection } from "@/components/chase/ChaseList";
import type { ChasePayload, ChaseStop } from "@/lib/chase-week";
import { formatWhen, placeLabel, type ReportFilter } from "@/lib/filters";
import { hazardLabel, hazardOf, magnitudeLabel } from "@/lib/hazard";
import { confidenceLabel } from "@/components/map-shared";
import type { HoneyMode } from "@/lib/honey";
import type { HailReport, SourceStatus } from "@/lib/types";

interface Props {
  loading: boolean;
  error: string | null;
  reports: HailReport[];
  filter: ReportFilter;
  status: SourceStatus | null;
  syncedAt: string | null;
  onSelect: (report: HailReport) => void;
  chase: ChasePayload | null;
  chaseLoading: boolean;
  chaseMode: HoneyMode;
  onChaseMode: (mode: HoneyMode) => void;
  onOpenChase: (stop: ChaseStop) => void;
}

export default function StormsPanel({ loading, error, reports, filter, status, syncedAt, onSelect, chase, chaseLoading, chaseMode, onChaseMode, onOpenChase }: Props) {
  return (
    <div className="page-enter h-full overflow-y-auto px-4 py-5 md:px-8" data-tone="storms">
      <header className="sheet-band">
        <p className="sheet-kicker">This week</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Storms</h1>
        <p className="sheet-sub mt-1 max-w-xl leading-relaxed">
          The Chase List is this week&apos;s best stops. Reports below are what people and radar saw in the map you were looking at.
        </p>
      </header>
      {chase ? (
        <ChaseSection mode={chaseMode} payload={chase} preview={false} onMode={onChaseMode} onSelect={onOpenChase} />
      ) : chaseLoading ? (
        <div aria-busy="true" className="mb-5 max-w-3xl space-y-2" data-chase-loading>
          <span className="sr-only">Loading this week&apos;s Money Holes…</span>
          <div className="skeleton h-28" />
        </div>
      ) : (
        <section className="chase-section" data-chase-section data-tone="chase" aria-label="Chase List">
          <p className="honey-kicker">Money Hole</p>
          <h2 className="text-xl font-semibold tracking-tight">Chase List</h2>
          <p className="honey-note">This week&apos;s Money Holes are unavailable right now.</p>
        </section>
      )}
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
          <p className="font-semibold text-ink">No hail here this week.</p>
          <p className="mt-1">See this week&apos;s biggest storms in the Chase List above.</p>
        </div>
      ) : null}
      <ul className="storm-list">
        {reports.slice(0, 300).map((report) => {
          const hazard = hazardOf(report.hazard);
          const Icon = hazard === "wind" ? Wind : hazard === "tornado" ? Tornado : CloudHail;
          return (
            <li key={report.id} className="min-w-0">
              <button type="button" onClick={() => onSelect(report)} className="storm-card">
                <span className="storm-size">{magnitudeLabel(report)}</span>
                <span className={`hazard-badge ${hazardClass(hazard)}`}>
                  <Icon size={18} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold tracking-tight">
                    {hazardLabel(hazard)} · {placeLabel(report)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {formatWhen(report.occurredAt)} · {confidenceLabel(report.confidence)}
                    {report.photoUrl ? " · community photo" : ""}
                    {report.source === "seed" ? " · sample" : ""}
                  </span>
                </span>
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
        <Feed label="Hail size" value={status?.mesh === "skipped" ? "hail paths on" : (status?.mesh ?? "checking")} />
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
