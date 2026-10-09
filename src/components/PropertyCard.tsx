"use client";

import { formatWhen, placeLabel } from "@/lib/filters";
import { hazardLabel, hazardOf, magnitudeLabel } from "@/lib/hazard";
import type { PlaceHistory } from "@/lib/place";

const TONE: Record<string, string> = {
  Low: "bg-emerald-700 text-white",
  Moderate: "bg-amber-700 text-white",
  High: "bg-orange-700 text-white",
  "Very High": "bg-rose-700 text-white",
};

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
    <article className="rounded-3xl border border-line bg-panel p-4 shadow-sheet">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Property</p>
          <h2 className="truncate text-base font-semibold">{label}</h2>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="text-sm text-muted">
            Close
          </button>
        ) : null}
      </div>
      <div className={`mt-3 inline-flex flex-col rounded-2xl px-3 py-2 ${TONE[score.level] ?? TONE.Low}`}>
        <span className="text-xs font-semibold uppercase tracking-wide">Damage probability</span>
        <span className="text-xl font-semibold">
          {score.level} · {score.score}/100
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">{score.summary}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Fact label="Max hail" value={history.maxHailIn != null ? `${history.maxHailIn.toFixed(2)} in` : "None in range"} />
        <Fact label="Max wind" value={history.maxWindMph != null ? `${history.maxWindMph} mph` : "None in range"} />
        <Fact label="Tornado" value={history.strongestTornado ?? "None in range"} />
        <Fact
          label="Nearest report"
          value={history.nearestKm != null ? `${history.nearestKm.toFixed(1)} km` : "None"}
        />
        <Fact label="Hail swath" value={history.swathHit ? "Covers this point" : "Does not cover this point"} />
        <Fact label="Reports" value={String(history.reports.length)} />
      </dl>
      <div className="mt-3 space-y-2">
        {score.factors.map((factor) => (
          <p key={factor.id} className="text-sm">
            <span className="font-semibold">
              {factor.label}
              {factor.points ? ` · ${factor.points}` : ""}
            </span>
            <span className="block text-xs text-muted">{factor.detail}</span>
          </p>
        ))}
      </div>
      <div className="mt-3 text-sm">
        <p className="font-semibold">Active alerts</p>
        {history.warningStatus === "unavailable" ? (
          <p className="text-muted">Watches and warnings could not be checked.</p>
        ) : history.warnings.length ? (
          <ul className="mt-1 space-y-1">
            {history.warnings.map((warning) => (
              <li key={`${warning.kind}-${warning.event}`}>
                {warning.event}
                {warning.until ? <span className="text-muted"> · until {formatWhen(warning.until)}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No active severe watch or warning covers this point.</p>
        )}
      </div>
      {mesh === "skipped" ? (
        <p className="mt-3 text-xs text-muted">Radar MESH is off until HAILMAP_MESH_URL is set. Nothing is filled in for it.</p>
      ) : null}
      {history.reports.length ? (
        <ul className="mt-3 max-h-40 divide-y divide-line overflow-auto text-sm">
          {history.reports.slice(0, 12).map((report) => (
            <li key={report.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="font-medium">
                  {hazardLabel(hazardOf(report.hazard))} · {magnitudeLabel(report)}
                </span>
                <span className="block text-xs text-muted">
                  {placeLabel(report)} · {report.distanceKm.toFixed(1)} km · {formatWhen(report.occurredAt)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">No hail, wind, or tornado reports in this radius and date range.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {onSave ? (
          <button type="button" onClick={onSave} className="rounded-full bg-accent px-3 py-1.5 text-sm font-semibold text-accentink">
            {saveLabel ?? "Save to watch list"}
          </button>
        ) : null}
        {onReport ? (
          <button type="button" onClick={onReport} className="rounded-full border border-line px-3 py-1.5 text-sm font-semibold">
            Storm report
          </button>
        ) : null}
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-app px-2.5 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
