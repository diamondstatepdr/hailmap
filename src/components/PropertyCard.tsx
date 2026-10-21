"use client";

import { type ReactNode } from "react";
import { Bell, CloudHail, Tornado, Wind } from "lucide-react";
import type { RadarSample } from "@/lib/area-selection";
import { formatWhen, placeLabel } from "@/lib/filters";
import { hazardLabel, hazardOf, magnitudeLabel } from "@/lib/hazard";
import type { PlaceHistory } from "@/lib/place";
import { topScoreFactors } from "@/lib/probability";
import { formatHailSources, formatMiles } from "@/lib/units";
import ScoreRing from "@/components/ui/ScoreRing";
import Sparkline from "@/components/ui/Sparkline";

interface Props {
  label: string;
  history: PlaceHistory;
  mesh?: string | null;
  radar?: RadarSample | null;
  radarLoading?: boolean;
  onSave?: () => void;
  onReport?: () => void;
  onProof?: () => void;
  proofBusy?: boolean;
  onAlert?: () => void;
  onClose?: () => void;
  saveLabel?: string;
  /** Drop the floating card chrome when a bottom sheet already provides it. */
  bare?: boolean;
  canvass?: ReactNode;
}

export default function PropertyCard({ label, history, mesh, radar, radarLoading, onSave, onReport, onProof, proofBusy, onAlert, onClose, saveLabel, bare, canvass }: Props) {
  const score = history.score;
  const factors = topScoreFactors(score.factors);
  const hailLine = formatHailSources({
    radarIn: radar?.maxIn,
    spotterIn: history.maxHailIn,
    radiusKm: history.radiusKm,
  });
  return (
    <article className={bare ? "px-4 pb-4" : "float-card p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Property</p>
          <h2 className="mt-1 text-lg font-semibold leading-tight tracking-tight">{label}</h2>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="btn btn-secondary press px-3 py-1.5 text-xs">
            Close
          </button>
        ) : null}
      </div>
      <div className="mt-4 flex items-center gap-4">
        <ScoreRing score={score.score} level={score.level} />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Damage probability</p>
          <p className="mt-0.5 text-xl font-semibold tracking-tight">{score.level}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{score.summary}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2">
        <Fact label="Max hail" value={hailLine} />
        <Fact label="Max wind" value={history.maxWindMph != null ? `${history.maxWindMph} mph` : "None in range"} />
        <Fact label="Tornado" value={history.strongestTornado ?? "None in range"} />
        <Fact label="Nearest report" value={history.nearestKm != null ? formatMiles(history.nearestKm) : "None"} />
        <Fact label="Hail swath" value={history.swathHit ? "Covers this point" : "Does not cover this point"} />
        <Fact
          label="Radar hail"
          value={radarLoading ? "Checking…" : radar?.maxIn != null ? `${radar.maxIn.toFixed(2)} in` : "None in range"}
        />
      </dl>
      {radar?.days.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {radar.days.map((day) => (
            <li key={`${day.label}-${day.date ?? "window"}`} className="flex items-baseline justify-between gap-3">
              <span className="text-muted">{day.label}</span>
              <span className="font-semibold">{day.maxIn != null ? `${day.maxIn.toFixed(2)} in` : "—"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {radar?.note ? <p className="mt-2 text-xs leading-relaxed text-muted">{radar.note}</p> : null}
      {history.reports.length ? (
        <div className="mt-4">
          <Sparkline times={history.reports.map((report) => report.occurredAt)} hours={history.hours} />
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {(factors.length ? factors : score.factors.slice(0, 1)).map((factor) => (
          <div key={factor.id}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold">{factor.label}</span>
              {factor.points ? <span className="text-xs font-semibold text-muted">{factor.points} pts</span> : null}
            </div>
            <div className="factor-track mt-1">
              <div className="factor-fill" style={{ width: `${Math.max(factor.points ? 6 : 0, Math.min(100, factor.points))}%` }} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{factor.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <p className="text-sm font-semibold">Active alerts</p>
        {history.warningStatus === "unavailable" ? (
          <p className="mt-1 text-sm text-muted">Watches and warnings could not be checked.</p>
        ) : history.warnings.length ? (
          <ul className="mt-2 space-y-1.5">
            {history.warnings.map((warning) => (
              <li key={`${warning.kind}-${warning.event}`} className="rounded-xl bg-panel-2 px-3 py-2 text-sm" style={{ background: "var(--panel-2)" }}>
                <span className="font-medium">{warning.event}</span>
                {warning.until ? <span className="block text-xs text-muted">Until {formatWhen(warning.until)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">No active severe watch or warning covers this point.</p>
        )}
      </div>
      {mesh === "skipped" && !radar ? (
        <p className="mt-3 text-xs text-muted">Radar hail size is unavailable for this window. Report swaths still load.</p>
      ) : null}
      {history.reports.length ? (
        <ul className="mt-3 max-h-44 space-y-1.5 overflow-auto">
          {history.reports.slice(0, 12).map((report) => {
            const hazard = hazardOf(report.hazard);
            const Icon = hazard === "wind" ? Wind : hazard === "tornado" ? Tornado : CloudHail;
            return (
              <li key={report.id} className="flex items-start gap-2 rounded-xl px-1 py-1.5 text-sm">
                <span className={`hazard-badge h-8 w-8 rounded-lg ${hazardClass(hazard)}`}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="font-medium">
                    {hazardLabel(hazard)} · {magnitudeLabel(report)}
                  </span>
                  <span className="block text-xs text-muted">
                    {placeLabel(report)} · {formatMiles(report.distanceKm)} · {formatWhen(report.occurredAt)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No hail, wind, or tornado reports in this radius and date range.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {onAlert ? (
          <button type="button" onClick={onAlert} className="btn btn-primary press">
            <Bell size={16} />
            Alert me here
          </button>
        ) : null}
        {onSave ? (
          <button type="button" onClick={onSave} className="btn btn-secondary press">
            {saveLabel ?? "Save to watch list"}
          </button>
        ) : null}
        {onReport ? (
          <button type="button" onClick={onReport} className="btn btn-secondary press">
            Storm report
          </button>
        ) : null}
        {onProof ? (
          <button type="button" onClick={onProof} disabled={proofBusy} className="btn btn-secondary press" data-hail-proof>
            {proofBusy ? "Making the PDF…" : "Hail proof PDF"}
          </button>
        ) : null}
      </div>
      {canvass}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function hazardClass(hazard: string): string {
  if (hazard === "wind") return "hazard-wind";
  if (hazard === "tornado") return "hazard-tornado";
  return "hazard-hail";
}
