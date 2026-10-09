"use client";

import { CloudHail, Tornado, Wind } from "lucide-react";
import { formatWhen, placeLabel } from "@/lib/filters";
import { hazardLabel, hazardOf, magnitudeLabel } from "@/lib/hazard";
import type { PlaceHistory } from "@/lib/place";
import ScoreRing from "@/components/ui/ScoreRing";
import Sparkline from "@/components/ui/Sparkline";

interface Props {
  label: string;
  history: PlaceHistory;
  mesh?: string | null;
  onSave?: () => void;
  onReport?: () => void;
  onClose?: () => void;
  saveLabel?: string;
}

export default function PropertyCard({ label, history, mesh, onSave, onReport, onClose, saveLabel }: Props) {
  const score = history.score;
  return (
    <article className="float-card p-4">
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
        <Fact label="Max hail" value={history.maxHailIn != null ? `${history.maxHailIn.toFixed(2)} in` : "None in range"} />
        <Fact label="Max wind" value={history.maxWindMph != null ? `${history.maxWindMph} mph` : "None in range"} />
        <Fact label="Tornado" value={history.strongestTornado ?? "None in range"} />
        <Fact label="Nearest report" value={history.nearestKm != null ? `${history.nearestKm.toFixed(1)} km` : "None"} />
        <Fact label="Hail swath" value={history.swathHit ? "Covers this point" : "Does not cover this point"} />
        <Fact label="Reports" value={String(history.reports.length)} />
      </dl>
      {history.reports.length ? (
        <div className="mt-4">
          <Sparkline times={history.reports.map((report) => report.occurredAt)} hours={history.hours} />
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {score.factors.map((factor) => (
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
      {mesh === "skipped" ? (
        <p className="mt-3 text-xs text-muted">Radar MESH is off until HAILMAP_MESH_URL is set. Nothing is filled in for it.</p>
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
                    {placeLabel(report)} · {report.distanceKm.toFixed(1)} km · {formatWhen(report.occurredAt)}
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
        {onSave ? (
          <button type="button" onClick={onSave} className="btn btn-primary press">
            {saveLabel ?? "Save to watch list"}
          </button>
        ) : null}
        {onReport ? (
          <button type="button" onClick={onReport} className="btn btn-secondary press">
            Storm report
          </button>
        ) : null}
      </div>
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
