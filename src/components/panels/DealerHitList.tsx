"use client";

import { useEffect } from "react";
import { dealerDirections, telHref } from "@/lib/dealer-hit";
import type { DealerPin } from "@/lib/area-selection";

export default function DealerHitList({
  dealers,
  selectedId = null,
  onSelect,
}: {
  dealers: Array<DealerPin & { hailIn: number }>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  useEffect(() => {
    if (!selectedId) return;
    document.querySelector(`[data-dealer-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);
  if (!dealers.length) return null;
  return (
    <div className="dealer-hit" data-dealer-hit>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Dealership hit list</p>
      <ol>
        {dealers.map((dealer, index) => {
          const tel = telHref(dealer.phone);
          const directions = dealerDirections(dealer.lat, dealer.lon);
          return (
            <li key={dealer.id} data-dealer-id={dealer.id} data-selected={dealer.id === selectedId ? "true" : "false"}>
              <button type="button" className="dealer-hit-main" onClick={() => onSelect?.(dealer.id)} aria-pressed={dealer.id === selectedId}>
                <span className="dealer-hit-rank">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{dealer.name}</span>
                  <span className="block text-xs text-muted">
                    {dealer.hailIn.toFixed(2)} in hail · {dealer.kind === "lot" ? "Car lot" : "Dealership"}
                  </span>
                </span>
              </button>
              <span className="dealer-hit-actions">
                  {tel ? <a href={tel}>Call</a> : null}
                  <a href={directions.google} target="_blank" rel="noreferrer">
                    Directions
                  </a>
                  <a href={directions.apple} target="_blank" rel="noreferrer">
                    Apple Maps
                  </a>
                </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
