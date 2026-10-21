"use client";

import { dealerDirections, telHref } from "@/lib/dealer-hit";
import type { DealerPin } from "@/lib/area-selection";

export default function DealerHitList({ dealers }: { dealers: Array<DealerPin & { hailIn: number }> }) {
  if (!dealers.length) return null;
  return (
    <div className="dealer-hit" data-dealer-hit>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Dealership hit list</p>
      <ol>
        {dealers.map((dealer, index) => {
          const tel = telHref(dealer.phone);
          const directions = dealerDirections(dealer.lat, dealer.lon);
          return (
            <li key={dealer.id}>
              <span className="dealer-hit-rank">{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{dealer.name}</span>
                <span className="block text-xs text-muted">
                  {dealer.hailIn.toFixed(2)} in hail · {dealer.kind === "lot" ? "Car lot" : "Dealership"}
                </span>
                <span className="dealer-hit-actions">
                  {tel ? (
                    <a href={tel}>{dealer.phone}</a>
                  ) : (
                    <span>No phone in OpenStreetMap</span>
                  )}
                  <a href={directions.google} target="_blank" rel="noreferrer">
                    Google Maps
                  </a>
                  <a href={directions.apple} target="_blank" rel="noreferrer">
                    Apple Maps
                  </a>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
