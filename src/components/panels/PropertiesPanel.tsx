"use client";

import AddressSearch, { type AddressHit } from "@/components/AddressSearch";
import PropertyCard from "@/components/PropertyCard";
import { TIME_WINDOWS } from "@/lib/filters";
import { laterPhase } from "@/lib/seams";
import type { PlaceHistory } from "@/lib/place";

export interface WatchItem {
  id: string;
  label: string;
  query: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

interface Props {
  radiusKm: number;
  hours: number;
  onRadius: (radiusKm: number) => void;
  onHours: (hours: number) => void;
  onSearch: (hit: AddressHit) => void;
  history: PlaceHistory | null;
  label: string | null;
  loading: boolean;
  error: string | null;
  mesh: string | null;
  signedIn: boolean;
  watch: WatchItem[];
  onSave: () => void;
  onOpenWatch: (item: WatchItem) => void;
  onRemoveWatch: (id: string) => void;
  onReport: () => void;
  onShowMap: () => void;
}

export default function PropertiesPanel(props: Props) {
  return (
    <div className="h-full overflow-y-auto px-4 py-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Addresses</h1>
        <p className="text-sm text-muted">
          Search a US address, city, or ZIP. History uses official reports inside the radius and date range.
        </p>
      </header>
      <AddressSearch onPick={props.onSearch} autoFocus />
      <div className="mt-3 flex flex-wrap gap-2">
        {[5, 10, 15, 25, 40].map((radius) => (
          <button
            key={radius}
            type="button"
            aria-pressed={props.radiusKm === radius}
            onClick={() => props.onRadius(radius)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              props.radiusKm === radius ? "bg-accent font-semibold text-accentink" : "border border-line"
            }`}
          >
            {radius} km
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {TIME_WINDOWS.map((item) => (
          <button
            key={item.hours}
            type="button"
            aria-pressed={props.hours === item.hours}
            onClick={() => props.onHours(item.hours)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              props.hours === item.hours ? "bg-accent font-semibold text-accentink" : "border border-line"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {props.loading ? <p className="mt-4 text-sm text-muted">Loading property history…</p> : null}
      {props.error ? <p className="mt-4 rounded-2xl border border-line px-3 py-2 text-sm text-muted">{props.error}</p> : null}
      {!props.history && !props.loading ? (
        <p className="mt-6 rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Search an address to see nearby hail, wind, tornado reports, swath coverage, alerts, and damage probability.
        </p>
      ) : null}
      {props.history && props.label ? (
        <div className="mt-4 space-y-3">
          <PropertyCard
            label={props.label}
            history={props.history}
            mesh={props.mesh}
            onSave={props.signedIn ? props.onSave : undefined}
            saveLabel={props.signedIn ? "Save to watch list" : undefined}
            onReport={props.onReport}
          />
          {!props.signedIn ? (
            <p className="text-sm text-muted">Sign in to save this address. The history above is public report data.</p>
          ) : null}
          <button type="button" onClick={props.onShowMap} className="text-sm font-semibold text-accent">
            Show on map
          </button>
        </div>
      ) : null}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Watch list</h2>
        {!props.signedIn ? <p className="mt-1 text-sm text-muted">Sign in to keep addresses on this device’s account.</p> : null}
        {props.signedIn && !props.watch.length ? <p className="mt-2 text-sm text-muted">No saved addresses yet.</p> : null}
        <ul className="mt-2 divide-y divide-line">
          {props.watch.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 py-2">
              <button type="button" onClick={() => props.onOpenWatch(item)} className="min-w-0 text-left">
                <span className="block truncate text-sm font-medium">{item.label}</span>
                <span className="text-xs text-muted">{item.radiusKm} km</span>
              </button>
              <button type="button" onClick={() => props.onRemoveWatch(item.id)} className="text-xs text-muted">
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
      {!laterPhase.roofAndPropertyIntelligence ? (
        <p className="mt-8 text-xs leading-relaxed text-muted">
          Roof and property records are a later release. This card uses storm reports only.
        </p>
      ) : null}
    </div>
  );
}
