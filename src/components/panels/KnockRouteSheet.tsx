"use client";

import { appleMapsHref, googleMapsHref, knockHailLabel, type KnockMode, type KnockStop } from "@/lib/knock-route";
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
  const title = stops.length ? knockHailLabel(stops) : label;
  return (
    <div className="sheet-dock pointer-events-none absolute inset-x-0 bottom-0 z-30 md:inset-x-3">
      <BottomSheet label="Door-knock route" tone="field" onClose={onClose} expandedMax="45dvh" peekHeight={132}>
        <div data-knock-sheet className="knock-sheet">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Door-knock route</p>
          <p className="knock-title" data-knock-label>{title}</p>
          {note ? <p className="knock-note" data-knock-note>{note}</p> : null}
          <div className="knock-modes" role="group" aria-label="Walk or drive">
            <button type="button" aria-pressed={mode === "walk"} onClick={() => onMode("walk")}>
              Walk
            </button>
            <button type="button" aria-pressed={mode === "drive"} onClick={() => onMode("drive")}>
              Drive
            </button>
          </div>
          {stops.length ? (
            <ol className="knock-list" data-knock-count={stops.length}>
              {stops.map((stop, index) => (
                <li key={`${stop.id}-${index}`} data-knock-stop={index + 1} data-hail={stop.hailIn}>
                  <span className="knock-pin">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{stop.name}</span>
                    <span className="text-xs text-muted">{formatStopHail(stop.hailIn)} hail</span>
                  </span>
                </li>
              ))}
              <li className="knock-list-end" aria-hidden="true" />
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
            <p className="knock-foot-note">{trimmed ? "Maps opens the first stops on this list." : "Opens this order in Maps."}</p>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

function formatStopHail(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}"`;
}
