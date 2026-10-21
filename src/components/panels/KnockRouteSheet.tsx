"use client";

import { appleMapsHref, googleMapsHref, type KnockMode, type KnockStop } from "@/lib/knock-route";
import BottomSheet from "@/components/ui/BottomSheet";

interface Props {
  label: string;
  stops: KnockStop[];
  mode: KnockMode;
  note: string | null;
  onMode: (mode: KnockMode) => void;
  onClose: () => void;
}

export default function KnockRouteSheet({ label, stops, mode, note, onMode, onClose }: Props) {
  const google = googleMapsHref(stops, mode);
  const apple = appleMapsHref(stops, mode);
  const trimmed = google.count < stops.length || apple.count < stops.length;
  return (
    <div className="sheet-dock pointer-events-none absolute inset-x-0 bottom-0 z-30 md:inset-x-3">
      <BottomSheet label="Door-knock route" tone="field" onClose={onClose} expandedMax="45dvh" peekHeight={132}>
        <div data-knock-sheet className="knock-sheet">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Door-knock route</p>
          <p className="mt-1 text-lg font-semibold tracking-tight" data-knock-label>{label}</p>
          {note ? <p className="knock-note text-muted">{note}</p> : null}
          <div className="knock-modes" role="group" aria-label="Walk or drive">
            <button type="button" aria-pressed={mode === "walk"} onClick={() => onMode("walk")}>
              Walk
            </button>
            <button type="button" aria-pressed={mode === "drive"} onClick={() => onMode("drive")}>
              Drive
            </button>
          </div>
          {stops.length ? (
            <ol className="knock-list">
              {stops.map((stop, index) => (
                <li key={stop.id}>
                  <span className="knock-pin">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{stop.name}</span>
                    <span className="text-xs text-muted">{stop.hailIn.toFixed(2)} in hail</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm">No streets to route yet.</p>
          )}
          <div className="knock-foot">
            <div className="flex flex-wrap gap-2">
              {google.url ? (
                <a className="btn btn-primary press" href={google.url} target="_blank" rel="noreferrer" data-knock-google>
                  Google Maps
                </a>
              ) : null}
              {apple.url ? (
                <a className="btn btn-secondary press" href={apple.url} target="_blank" rel="noreferrer" data-knock-apple>
                  Apple Maps
                </a>
              ) : null}
            </div>
            {trimmed ? (
              <p className="mt-2 text-xs text-muted">
                Google Maps opens {google.count} stops (9 between the start and the end). Apple Maps opens {apple.count}. The map shows the full walk.
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">Opens this order in Google Maps or Apple Maps.</p>
            )}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
