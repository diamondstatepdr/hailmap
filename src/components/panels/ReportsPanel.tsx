"use client";

import { FileText, Map } from "lucide-react";

export interface SavedReport {
  id: string;
  title: string;
  createdAt: string;
}

interface Props {
  canUseView: boolean;
  hasPlace: boolean;
  placeLabel: string | null;
  busy: boolean;
  error: string | null;
  lastUrl: string | null;
  saved: SavedReport[];
  signedIn: boolean;
  onAddress: () => void;
  onView: () => void;
}

export default function ReportsPanel({
  canUseView,
  hasPlace,
  placeLabel,
  busy,
  error,
  lastUrl,
  saved,
  signedIn,
  onAddress,
  onView,
}: Props) {
  return (
    <div className="page-enter h-full overflow-y-auto px-4 py-5 md:px-8">
      <header className="mb-5 max-w-3xl">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">Printable</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
          A printable storm report with the map sketch, nearby reports, damage probability, and your field photos if you are signed in.
        </p>
      </header>
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={!hasPlace || busy}
          onClick={onAddress}
          className="storm-card h-full items-start disabled:opacity-50"
        >
          <span className="hazard-badge hazard-hail">
            <FileText size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold">{busy ? "Building the report…" : "Address report"}</span>
            <span className="mt-0.5 block text-xs text-muted">{placeLabel ?? "Search an address first"}</span>
          </span>
        </button>
        <button
          type="button"
          disabled={!canUseView || busy}
          onClick={onView}
          className="storm-card h-full items-start disabled:opacity-50"
        >
          <span className="hazard-badge hazard-wind">
            <Map size={18} />
          </span>
          <span>
            <span className="block text-sm font-semibold">Current map view</span>
            <span className="mt-0.5 block text-xs text-muted">Reports inside the box on screen</span>
          </span>
        </button>
      </div>
      {!hasPlace ? <p className="mt-3 max-w-xl text-sm text-muted">Search an address on the map or Addresses tab first.</p> : null}
      {error ? <p className="mt-3 text-sm text-muted">{error}</p> : null}
      {lastUrl ? (
        <a href={lastUrl} className="btn btn-primary press mt-4">
          Open the report
        </a>
      ) : null}
      <p className="mt-4 max-w-xl text-xs leading-relaxed text-muted">
        Open the report and use Print or save as PDF. Field photos appear only for the signed-in account and are labeled as field notes, not official reports.
        {!signedIn ? " Sign in before generating if you want your photos included." : ""}
      </p>
      <section className="mt-8 max-w-3xl">
        <h2 className="text-sm font-semibold tracking-tight">Your saved reports</h2>
        {!signedIn ? <p className="mt-1 text-sm text-muted">Sign in to see reports tied to your name.</p> : null}
        {signedIn && !saved.length ? (
          <div className="empty-state mt-3">
            <p className="text-sm">No saved reports yet.</p>
          </div>
        ) : null}
        {saved.length ? (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
          {saved.map((item) => (
            <li key={item.id}>
              <a href={`/reports/${item.id}`} className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-app">
                <span>
                  <span className="block text-sm font-semibold text-ink">{item.title}</span>
                  <span className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</span>
                </span>
                <FileText size={16} className="text-accent" />
              </a>
            </li>
          ))}
        </ul>
        ) : null}
      </section>
    </div>
  );
}
