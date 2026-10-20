"use client";

import { Gem, X } from "lucide-react";

export type HoneyMode = "pdr" | "roof";

export interface HoneySpotView {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  hailIn: number;
  vehicles: number | null;
  homes: number | null;
  score: number;
  level: string;
  distanceKm: number | null;
  sourceLabel: string;
}

interface Props {
  label: string;
  mode: HoneyMode;
  onMode: (mode: HoneyMode) => void;
  showHeat: boolean;
  onToggleHeat: () => void;
  loading: boolean;
  note: string | null;
  error: string | null;
  spots: HoneySpotView[];
  selectedId: string | null;
  onSelect: (spot: HoneySpotView) => void;
  onClose: () => void;
  attribution: string | null;
  needsDay: boolean;
  /** Miles are only shown when they are measured from the tech or a searched address. */
  distanceFrom: "you" | "search" | null;
}

const KIND_LABEL: Record<string, string> = {
  dealership: "Dealership",
  parking: "Parking",
  mall: "Mall",
  fleet: "Fleet yard",
  apartments: "Apartments",
  homes: "Neighborhood",
};

export default function HoneyPanel(props: Props) {
  const countLabel = props.mode === "pdr" ? "vehicles" : "homes";
  return (
    <aside
      className="honey-dock glass"
      data-honey-panel
      data-mode={props.mode}
      data-honey-status={props.loading && !props.needsDay ? "loading" : props.spots.length ? "ready" : "empty"}
      aria-label="Money holes"
    >
      <header className="honey-head">
        <div className="min-w-0">
          <p className="honey-kicker">
            <Gem size={13} />
            Money Hole score
          </p>
          <h2>Money Holes</h2>
          <p className="truncate text-xs text-muted">{props.label}</p>
        </div>
        <button type="button" className="honey-close press" onClick={props.onClose} aria-label="Close money holes">
          <X size={16} />
        </button>
      </header>
      <div className="honey-modes" role="group" aria-label="PDR or roofing">
        <button type="button" aria-pressed={props.mode === "pdr"} onClick={() => props.onMode("pdr")}>
          PDR
          <small>Vehicles</small>
        </button>
        <button type="button" aria-pressed={props.mode === "roof"} onClick={() => props.onMode("roof")}>
          Roofing
          <small>Homes</small>
        </button>
      </div>
      <button
        type="button"
        className="honey-heat press"
        aria-pressed={props.showHeat}
        data-honey-heat
        onClick={props.onToggleHeat}
      >
        <span className="honey-switch" aria-hidden />
        Heat layer
      </button>
      <div className="honey-body">
        {props.needsDay ? (
          <p className="honey-note">Pick a storm day, or use Live through 24 hours. Money holes rank one convective day.</p>
        ) : null}
        {props.error ? <p className="honey-note">{props.error}</p> : null}
        {props.note && !props.error ? <p className="honey-note">{props.note}</p> : null}
        {props.loading && !props.needsDay ? (
          <div aria-busy="true" className="space-y-2 px-1" data-honey-loading>
            <p className="honey-note">Finding Money Holes…</p>
            <div className="skeleton h-14" />
            <div className="skeleton h-14" />
            <div className="skeleton h-14" />
          </div>
        ) : null}
        {!props.needsDay && !props.loading && !props.spots.length && !props.error ? (
          <p className="honey-note">No hail-hit stops in this view yet.</p>
        ) : null}
        {props.loading ? null : <ol className="honey-list">
          {props.spots.map((spot, index) => {
            const count = props.mode === "pdr" ? spot.vehicles : spot.homes;
            const selected = props.selectedId === spot.id;
            return (
              <li key={spot.id}>
                <button
                  type="button"
                  className="honey-row press"
                  data-honey-spot
                  data-selected={selected ? "true" : "false"}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => props.onSelect(spot)}
                >
                  <span className="honey-rank">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="honey-name">{spot.name}</span>
                    <span className="honey-meta">
                      {KIND_LABEL[spot.kind] ?? "Stop"} · {spot.hailIn.toFixed(2)} in
                      {count != null ? ` · ${count.toLocaleString("en-US")} ${countLabel}` : ""}
                      {spot.distanceKm != null && props.distanceFrom ? ` · ${miles(spot.distanceKm)} from ${props.distanceFrom}` : ""}
                    </span>
                    <span className="honey-source">{spot.sourceLabel}</span>
                  </span>
                  <span className="honey-score" data-level={spot.level} title={`${spot.score} of 100 · ${spot.level}`}>
                    {spot.score}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>}
      </div>
      {props.attribution ? <p className="honey-attrib">{props.attribution}</p> : null}
    </aside>
  );
}

function miles(km: number): string {
  const value = km * 0.621371;
  if (value < 10) return `${value.toFixed(1)} mi`;
  return `${Math.round(value)} mi`;
}
