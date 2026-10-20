"use client";

import { Gem } from "lucide-react";
import { CHASE_PREVIEW, type ChasePayload, type ChaseStop } from "@/lib/chase-week";
import type { HoneyMode } from "@/lib/honey";
import { formatDay } from "@/lib/history-range";

interface RowsProps {
  mode: HoneyMode;
  payload: ChasePayload;
  preview: boolean;
  onSelect: (stop: ChaseStop) => void;
}

interface SectionProps extends RowsProps {
  onMode: (mode: HoneyMode) => void;
}

export function chaseStops(payload: ChasePayload, mode: HoneyMode, preview: boolean): ChaseStop[] {
  const ranked = payload.quiet ? payload.fallback[mode] : payload.fresh[mode];
  return preview ? ranked.slice(0, CHASE_PREVIEW) : ranked;
}

export function ChaseModeToggle({ mode, onMode }: { mode: HoneyMode; onMode: (mode: HoneyMode) => void }) {
  return (
    <div className="honey-modes" role="group" aria-label="PDR or roofing">
      <button type="button" aria-pressed={mode === "pdr"} onClick={() => onMode("pdr")}>
        PDR
        <small>Vehicles</small>
      </button>
      <button type="button" aria-pressed={mode === "roof"} onClick={() => onMode("roof")}>
        Roofing
        <small>Homes</small>
      </button>
    </div>
  );
}

function inches(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function countLine(stop: ChaseStop, mode: HoneyMode): string {
  if (mode === "pdr") {
    if (stop.vehicles == null) return "Vehicles in path loading";
    return `${stop.vehicles.toLocaleString("en-US")} vehicles in path`;
  }
  if (stop.homes == null) return "Homes in path loading";
  return `${stop.homes.toLocaleString("en-US")} homes in path`;
}

export function ChaseRows({ mode, payload, preview, onSelect }: RowsProps) {
  const stops = chaseStops(payload, mode, preview);
  return (
    <div data-chase-list={payload.quiet ? "quiet" : "ready"}>
      {payload.quiet ? (
        <div className="chase-empty" data-chase-empty>
          <Gem size={18} />
          <p className="text-sm font-semibold text-ink">Quiet week</p>
          <p className="mt-1 text-sm leading-relaxed">No fresh Money Holes in the last 7 days.</p>
        </div>
      ) : null}
      {payload.quiet && stops.length ? <h3 className="chase-subhead">Recent major storms</h3> : null}
      {!payload.quiet && !stops.length ? <p className="honey-note">No Money Holes in this list yet.</p> : null}
      {stops.length ? (
        <ol className="honey-list">
          {stops.map((stop, index) => (
            <li key={stop.id}>
              <button type="button" className="honey-row press" data-chase-stop onClick={() => onSelect(stop)}>
                <span className="honey-rank">{index + 1}</span>
                <span className="min-w-0">
                  <span className="honey-name">{stop.name}</span>
                  <span className="honey-meta">
                    {formatDay(stop.date)} · Radar {inches(stop.radarIn)} · Spotter {inches(stop.spotterIn)}
                  </span>
                  <span className="honey-meta">{countLine(stop, mode)}</span>
                </span>
                <span className="honey-score" data-level={stop.level} title={`${stop.score} Money Hole score · ${stop.level}`}>
                  {stop.score}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {payload.partial && stops.length ? (
        <p className="honey-note">Money Hole scores firm up as vehicle and home counts load.</p>
      ) : null}
    </div>
  );
}

export function ChaseSection({ mode, payload, preview, onMode, onSelect }: SectionProps) {
  return (
    <section className="chase-section" data-chase-section aria-label="Chase List">
      <header className="chase-section-head">
        <p className="honey-kicker">
          <Gem size={13} />
          Money Hole
        </p>
        <h2>Chase List</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          This week&apos;s hail areas, ranked by Money Hole score. {formatDay(payload.windowStart)} – {formatDay(payload.windowEnd)}.
        </p>
      </header>
      <ChaseModeToggle mode={mode} onMode={onMode} />
      <ChaseRows mode={mode} payload={payload} preview={preview} onSelect={onSelect} />
    </section>
  );
}
