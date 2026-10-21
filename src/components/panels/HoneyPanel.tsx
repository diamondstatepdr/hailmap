"use client";

import { Gem, X } from "lucide-react";
import Explain from "@/components/ui/Explain";
import UpdatedLine from "@/components/ui/UpdatedLine";
import { formatHoneyDetail, RADAR_TIP, SCORE_TIP } from "@/lib/plain";
import { formatMiles } from "@/lib/units";

export type HoneyMode = "pdr" | "roof";

export interface HoneySpotView {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  hailIn: number;
  radarIn?: number | null;
  spotterIn?: number | null;
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
  updatedAt?: string | null;
  needsDay: boolean;
  zoomedOut?: boolean;
  /** Miles are only shown when they are measured from the tech or a searched address. */
  distanceFrom: "you" | "search" | null;
  onRoute?: () => void;
  routeBusy?: boolean;
  routeError?: string | null;
  onForecast?: () => void;
}

export default function HoneyPanel(props: Props) {
  return (
    <aside
      className="honey-dock glass"
      data-tone="money"
      data-honey-panel
      data-mode={props.mode}
      data-honey-status={props.loading && !props.needsDay ? "loading" : props.spots.length ? "ready" : "empty"}
      aria-label="Money Hole"
    >
      <header className="honey-head sheet-band">
        <div className="min-w-0">
          <p className="honey-kicker">
            <Gem size={13} />
            Money Hole score
            <Explain label="What the score and hail sizes mean?">{`${SCORE_TIP} ${RADAR_TIP}`}</Explain>
          </p>
          <h2>Money spots</h2>
          <p className="truncate text-muted">{props.label}</p>
          <UpdatedLine at={props.updatedAt} />
        </div>
        <button type="button" className="honey-close press" onClick={props.onClose} aria-label="Close Money Hole">
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
      <p className="honey-note">PDR follows cars. Roofing follows homes.</p>
      <button
        type="button"
        className="honey-heat press"
        aria-pressed={props.showHeat}
        data-honey-heat
        onClick={props.onToggleHeat}
      >
        <span className="honey-switch" aria-hidden />
        Show on the map
      </button>
      {props.onRoute ? (
        <button
          type="button"
          className="btn btn-primary press"
          data-knock-route
          disabled={Boolean(props.routeBusy || props.needsDay || !props.spots.length)}
          onClick={props.onRoute}
        >
          {props.routeBusy ? "Building the route…" : "Door-knock route"}
        </button>
      ) : null}
      {props.routeError ? <p className="honey-note">{props.routeError}</p> : null}
      {props.onForecast ? (
        <button type="button" className="btn btn-primary press" data-forecast-open disabled={!props.spots.length || props.needsDay} onClick={props.onForecast}>
          Storm-to-cash
        </button>
      ) : null}
      <div className="honey-body">
        {props.needsDay ? (
          <p className="honey-note">Pick the day the hail fell. Money spots are ranked one storm at a time.</p>
        ) : null}
        {props.error ? <p className="honey-note">{props.error}</p> : null}
        {props.note && !props.error ? <p className="honey-note">{props.note}</p> : null}
        {props.loading && !props.needsDay ? (
          <div aria-busy="true" className="space-y-2 px-1" data-honey-loading>
            <p className="honey-note">Finding the best lots and neighborhoods…</p>
            <div className="honey-progress" />
            <div className="skeleton h-14" />
            <div className="skeleton h-14" />
            <div className="skeleton h-14" />
          </div>
        ) : null}
        {props.zoomedOut && !props.loading ? (
          <p className="honey-note">Zoom in to a city to see the best stops.</p>
        ) : null}
        {!props.needsDay && !props.zoomedOut && !props.loading && !props.spots.length && !props.error ? (
          <p className="honey-note">No hail here on this day. Move the map onto a hail path, or pick another storm day.</p>
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
                      {formatHoneyDetail({
                        radarIn: spot.radarIn,
                        spotterIn: spot.spotterIn,
                        hailIn: spot.hailIn,
                        count,
                        noun: props.mode === "pdr" ? "cars" : "homes",
                      })}
                      {spot.distanceKm != null && props.distanceFrom ? ` · ${formatMiles(spot.distanceKm)} from ${props.distanceFrom}` : ""}
                    </span>
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

