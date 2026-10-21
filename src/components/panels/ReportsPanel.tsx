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
  onFindAddress: () => void;
  onSignIn: () => void;
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
  onFindAddress,
  onSignIn,
}: Props) {
  return (
    <div className="page-enter h-full overflow-y-auto px-4 py-5 md:px-8" data-tone="reports">
      <header className="sheet-band">
        <p className="sheet-kicker">Printable</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="sheet-sub mt-1 max-w-xl text-sm leading-relaxed">
          A printable storm report with radar hail size, nearby warnings, a map snapshot, damage probability, and your field photos if you are signed in.
        </p>
      </header>
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={hasPlace && busy}
          onClick={hasPlace ? onAddress : onFindAddress}
          className="storm-card h-full items-start disabled:opacity-50"
        >
          <span className="hazard-badge hazard-hail">
            <FileText size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{busy ? "Building the report…" : "Address report"}</span>
            <span className="mt-0.5 block text-xs text-muted">{placeLabel ?? "Search an address"}</span>
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
      {!hasPlace ? (
        <div className="mt-3 max-w-xl">
          <p className="text-sm text-muted">An address report needs a place first.</p>
          <button type="button" onClick={onFindAddress} className="btn btn-primary press mt-2">
            Search an address
          </button>
        </div>
      ) : null}
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
        {!signedIn ? (
          <div className="mt-1 max-w-xl text-sm text-muted">
            <p>
              Sign in with the team passcode to see reports saved on your name. The passcode is shared by whoever set up Swathline. It is not a personal password.
            </p>
            <button type="button" onClick={onSignIn} className="btn btn-secondary press mt-2">
              Sign in
            </button>
          </div>
        ) : null}
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
