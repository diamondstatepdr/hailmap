"use client";

import { House, MapPinned } from "lucide-react";
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
    <div className="page-enter h-full overflow-y-auto px-4 py-5 md:px-8">
      <header className="mb-4 max-w-3xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Property history</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Addresses</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
          Search a US address, city, or ZIP. History uses official reports inside the radius and date range.
        </p>
      </header>
      <div className="max-w-3xl">
        <AddressSearch onPick={props.onSearch} autoFocus />
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Search radius">
        {[5, 10, 15, 25, 40].map((radius) => (
          <button
            key={radius}
            type="button"
            aria-pressed={props.radiusKm === radius}
            onClick={() => props.onRadius(radius)}
            className={`press rounded-full px-3 py-1.5 text-sm ${props.radiusKm === radius ? "chip-on" : "chip"}`}
          >
            {radius} km
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Time window">
        {TIME_WINDOWS.map((item) => (
          <button
            key={item.hours}
            type="button"
            aria-pressed={props.hours === item.hours}
            onClick={() => props.onHours(item.hours)}
            className={`press rounded-full px-3 py-1.5 text-sm ${props.hours === item.hours ? "chip-on" : "chip"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {props.loading ? (
        <div aria-busy="true" className="mt-4 max-w-3xl space-y-2">
          <span className="sr-only">Loading property history…</span>
          <div className="skeleton h-36" />
          <div className="grid grid-cols-2 gap-2">
            <div className="skeleton h-16" />
            <div className="skeleton h-16" />
          </div>
        </div>
      ) : null}
      {props.error ? <p className="mt-4 max-w-3xl rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-muted">{props.error}</p> : null}
      {!props.history && !props.loading ? (
        <div className="empty-state mt-6 max-w-xl">
          <House className="mx-auto mb-2" size={26} />
          <p className="text-sm font-semibold text-ink">Search an address</p>
          <p className="mt-1 text-sm">
            Nearby hail, wind, and tornado reports, swath coverage, alerts, and damage probability show up here.
          </p>
        </div>
      ) : null}
      {props.history && props.label ? (
        <div className="mt-4 max-w-3xl space-y-3">
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
          <button type="button" onClick={props.onShowMap} className="btn btn-secondary press">
            <MapPinned size={16} />
            Show on map
          </button>
        </div>
      ) : null}
      <section className="mt-8 max-w-3xl">
        <h2 className="text-sm font-semibold">Watch list</h2>
        {!props.signedIn ? <p className="mt-1 text-sm text-muted">Sign in to keep addresses on this device’s account.</p> : null}
        {props.signedIn && !props.watch.length ? <p className="mt-2 text-sm text-muted">No saved addresses yet.</p> : null}
        {props.watch.length ? (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {props.watch.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <button type="button" onClick={() => props.onOpenWatch(item)} className="min-w-0 text-left">
                <span className="block truncate text-sm font-medium">{item.label}</span>
                <span className="text-xs text-muted">{item.radiusKm} km</span>
              </button>
              <button type="button" onClick={() => props.onRemoveWatch(item.id)} className="text-xs font-semibold text-muted">
                Remove
              </button>
            </li>
          ))}
        </ul>
        ) : null}
      </section>
      {!laterPhase.roofAndPropertyIntelligence ? (
        <p className="mt-8 max-w-xl text-xs leading-relaxed text-muted">
          Roof and property records are a later release. This card uses storm reports only.
        </p>
      ) : null}
    </div>
  );
}
