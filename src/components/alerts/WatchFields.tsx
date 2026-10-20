"use client";

import { HAIL_THRESHOLDS, RADIUS_MILES } from "@/lib/alert-model";

interface Props {
  radiusMi: number;
  minSizeIn: number;
  mesh: boolean;
  reports: boolean;
  warnings: boolean;
  outlook: boolean;
  showRadius?: boolean;
  onRadius: (radiusMi: number) => void;
  onThreshold: (minSizeIn: number) => void;
  onToggle: (key: "mesh" | "reports" | "warnings" | "outlook") => void;
}

const TYPES: Array<{ key: "mesh" | "reports" | "warnings" | "outlook"; label: string }> = [
  { key: "mesh", label: "Radar hail" },
  { key: "reports", label: "Spotter reports" },
  { key: "warnings", label: "NWS warnings" },
  { key: "outlook", label: "Storm outlook" },
];

export default function WatchFields({
  radiusMi,
  minSizeIn,
  mesh,
  reports,
  warnings,
  outlook,
  showRadius = true,
  onRadius,
  onThreshold,
  onToggle,
}: Props) {
  const flags = { mesh, reports, warnings, outlook };
  return (
    <div className="space-y-3">
      {showRadius ? (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Radius</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Watch radius">
            {RADIUS_MILES.map((miles) => (
              <button
                key={miles}
                type="button"
                aria-pressed={radiusMi === miles}
                onClick={() => onRadius(miles)}
                className={`press rounded-full px-3 py-1 text-sm ${radiusMi === miles ? "chip-on" : "chip"}`}
              >
                {miles} mi
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Hail size</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Hail size threshold">
          {HAIL_THRESHOLDS.map((item) => (
            <button
              key={item.inches}
              type="button"
              aria-pressed={minSizeIn === item.inches}
              onClick={() => onThreshold(item.inches)}
              className={`press rounded-full px-3 py-1 text-sm ${minSizeIn === item.inches ? "chip-on" : "chip"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Send</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {TYPES.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={flags[item.key]}
              onClick={() => onToggle(item.key)}
              className={`press rounded-full px-3 py-1 text-sm ${flags[item.key] ? "chip-on" : "chip"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
