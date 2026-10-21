"use client";

import { Gem } from "lucide-react";
import Explain from "@/components/ui/Explain";
import UpdatedLine from "@/components/ui/UpdatedLine";
import { RADAR_TIP, SCORE_TIP } from "@/lib/plain";
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

function hailInches(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${value.toFixed(2)}"`;
}

function countLine(stop: ChaseStop, mode: HoneyMode): string | null {
  if (mode === "pdr") {
    if (stop.vehicles == null) return null;
    return `${stop.vehicles.toLocaleString("en-US")} vehicles in the hail path`;
  }
  if (stop.homes == null) return null;
  return `${stop.homes.toLocaleString("en-US")} homes in the hail path`;
}

export function ChaseRows({ mode, payload, preview, onSelect }: RowsProps) {
  const stops = chaseStops(payload, mode, preview);
  return (
    <div data-chase-list={payload.quiet ? "quiet" : "ready"}>
      {payload.quiet ? (
        <div className="chase-empty" data-chase-empty>
          <Gem size={18} />
          <p className="text-sm font-semibold text-ink">No hail here this week.</p>
          <p className="mt-1 text-sm leading-relaxed">See this week&apos;s biggest storms below.</p>
        </div>
      ) : null}
      {payload.quiet && stops.length ? <h3 className="chase-subhead">Recent major storms</h3> : null}
      {!payload.quiet && !stops.length ? <p className="honey-note">No hail here this week. See this week&apos;s biggest storms.</p> : null}
      {stops.length ? (
        <ol className="honey-list">
          {stops.map((stop, index) => {
            const radar = hailInches(stop.radarIn);
            const spotter = hailInches(stop.spotterIn);
            const count = countLine(stop, mode);
            return (
            <li key={stop.id}>
              <button type="button" className="honey-row press" data-chase-stop onClick={() => onSelect(stop)}>
                <span className="honey-rank">{index + 1}</span>
                <span className="min-w-0">
                  <span className="honey-name">
                    <span className="chase-title">{stop.name}</span>
                    {stop.source === "mesh" ? <span className="chase-radar">Radar size only</span> : null}
                  </span>
                  <span className="honey-meta">
                    {formatDay(stop.date)} · Radar size {radar ?? "—"} · {spotter ? `Spotter size ${spotter}` : "No spotter report"}
                  </span>
                  {count ? <span className="honey-meta">{count}</span> : null}
                </span>
                <span className="honey-score" data-level={stop.level} title={`${stop.score} Money Hole score · ${stop.level}`}>
                  {stop.score}
                </span>
              </button>
            </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

export function ChaseSection({ mode, payload, preview, onMode, onSelect }: SectionProps) {
  return (
    <section className="chase-section" data-chase-section data-tone="chase" aria-label="Chase List">
      <header className="chase-section-head sheet-band">
        <p className="honey-kicker">
          <Gem size={13} />
          Best stops
          <Explain label="What the score and hail sizes mean?">{`${SCORE_TIP} ${RADAR_TIP}`}</Explain>
        </p>
        <h2>Chase List</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          This week&apos;s hail, ranked by Money Hole score. {formatDay(payload.windowStart)} – {formatDay(payload.windowEnd)}.
        </p>
        <UpdatedLine at={payload.generatedAt} />
      </header>
      <ChaseModeToggle mode={mode} onMode={onMode} />
      <p className="honey-note">PDR follows cars. Roofing follows homes.</p>
      <ChaseRows mode={mode} payload={payload} preview={preview} onSelect={onSelect} />
    </section>
  );
}
