"use client";

import { laterPhase } from "@/lib/seams";

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
    <div className="h-full overflow-y-auto px-4 py-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted">
          A printable storm report with the map sketch, nearby reports, damage probability, and your field photos if you are signed in.
        </p>
      </header>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={!hasPlace || busy}
          onClick={onAddress}
          className="rounded-2xl bg-accent px-4 py-3 text-left text-sm font-semibold text-accentink disabled:opacity-50"
        >
          {busy ? "Building the report…" : `Report ${placeLabel ?? "the searched address"}`}
        </button>
        {!hasPlace ? <p className="text-sm text-muted">Search an address on the map or Addresses tab first.</p> : null}
        <button
          type="button"
          disabled={!canUseView || busy}
          onClick={onView}
          className="rounded-2xl border border-line px-4 py-3 text-left text-sm font-semibold disabled:opacity-50"
        >
          Report the current map view
        </button>
      </div>
      {busy ? <p className="mt-3 text-sm text-muted">Building the report…</p> : null}
      {error ? <p className="mt-3 text-sm text-muted">{error}</p> : null}
      {lastUrl ? (
        <a href={lastUrl} className="mt-3 inline-block text-sm font-semibold text-accent">
          Open the report
        </a>
      ) : null}
      <p className="mt-4 text-xs leading-relaxed text-muted">
        Open the report and use Print or save as PDF. Field photos appear only for the signed-in account and are labeled as field notes, not official reports.
        {!signedIn ? " Sign in before generating if you want your photos included." : ""}
      </p>
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Your saved reports</h2>
        {!signedIn ? <p className="mt-1 text-sm text-muted">Sign in to see reports tied to your name.</p> : null}
        {signedIn && !saved.length ? <p className="mt-2 text-sm text-muted">No saved reports yet.</p> : null}
        <ul className="mt-2 divide-y divide-line">
          {saved.map((item) => (
            <li key={item.id} className="py-2">
              <a href={`/reports/${item.id}`} className="text-sm font-medium text-accent">
                {item.title}
              </a>
              <p className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      </section>
      {!laterPhase.askAboutStorms ? (
        <p className="mt-8 text-xs leading-relaxed text-muted">
          An AI briefing on storms and markets is a later release. This report is built only from the data listed on the page.
        </p>
      ) : null}
    </div>
  );
}
