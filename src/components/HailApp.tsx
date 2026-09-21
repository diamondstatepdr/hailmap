"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MapFocus, MapFrame } from "@/components/HailMap";
import { boundsOf } from "@/lib/geo";
import { applyReportFilter, formatWhen, placeLabel, reportsToPointCollection, type ReportFilter } from "@/lib/filters";
import { reportsToSwaths } from "@/lib/swath";
import type { Confidence } from "@/lib/confidence";
import type { HailReport, ReportsResponse, SourceStatus } from "@/lib/types";

const HailMap = dynamic(() => import("@/components/HailMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-app text-sm text-muted">Loading map…</div>
  ),
});

const CONFIDENCE_OPTIONS: Array<{ id: Confidence; label: string }> = [
  { id: "nws", label: "NWS" },
  { id: "spotter", label: "Spotter" },
  { id: "mesh", label: "MESH" },
  { id: "community", label: "Community" },
];

const WINDOWS = [
  { hours: 6, label: "6h" },
  { hours: 24, label: "24h" },
  { hours: 72, label: "3d" },
  { hours: 168, label: "7d" },
];

function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function HailApp() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [reports, setReports] = useState<HailReport[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showPoints, setShowPoints] = useState(true);
  const [showSwaths, setShowSwaths] = useState(true);
  const [showIncome, setShowIncome] = useState(false);
  const [income, setIncome] = useState<GeoJSON.FeatureCollection | null>(null);
  const [incomeError, setIncomeError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [county, setCounty] = useState<{ fips?: string; income: number | null } | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [frame, setFrame] = useState<MapFrame | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<ReportFilter>({
    minSize: 0,
    hours: 168,
    confidences: ["nws", "spotter", "mesh", "community"],
    state: "",
  });

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/reports", { cache: "no-store" });
        if (!response.ok) throw new Error("reports failed");
        const payload = (await response.json()) as ReportsResponse;
        if (cancelled) return;
        setReports(payload.reports ?? []);
        setRawCount(payload.rawCount ?? payload.reports?.length ?? 0);
        setStatus(payload.sourceStatus);
        setSyncedAt(payload.syncedAt);
        setError(null);
      } catch {
        if (!cancelled) setError("Live reports are unavailable. Saved reports will show when the database is reachable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reloadKey]);

  useEffect(() => {
    if (!showIncome || income || incomeError) return;
    let cancelled = false;
    fetch("/api/income")
      .then((response) => response.json())
      .then((payload: GeoJSON.FeatureCollection) => {
        if (!cancelled) setIncome(payload);
      })
      .catch(() => {
        if (!cancelled) setIncomeError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [showIncome, income, incomeError]);

  const filtered = useMemo(() => applyReportFilter(reports, filter), [reports, filter]);
  const selected = filtered.find((report) => report.id === selectedId) ?? null;
  const points = useMemo(() => reportsToPointCollection(filtered), [filtered]);
  const stateCounts = useMemo(() => {
    const visible = applyReportFilter(reports, { ...filter, state: "" });
    const counts = new Map<string, number>();
    for (const report of visible) {
      const code = (report.state ?? "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [reports, filter]);
  const swaths = useMemo(
    () =>
      reportsToSwaths(
        filtered.map((report) => ({
          id: report.id,
          lat: report.lat,
          lon: report.lon,
          occurredAt: report.occurredAt,
          sizeIn: report.sizeIn,
          confidence: report.confidence,
        })),
      ),
    [filtered],
  );

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("hailmap-theme", next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#0e141c" : "#f3f6fb");
  }

  function frameFilter(next: ReportFilter) {
    const bounds = boundsOf(applyReportFilter(reports, next));
    if (!bounds) return;
    setFrame({ ...bounds, nonce: Date.now() });
  }

  function setHours(hours: number) {
    if (filter.hours === hours) return;
    const next = { ...filter, hours };
    setFilter(next);
    frameFilter(next);
  }

  function setStateFilter(state: string) {
    const next = { ...filter, state };
    setFilter(next);
    frameFilter(next);
  }

  function toggleConfidence(id: Confidence) {
    setFilter((current) => {
      const has = current.confidences.includes(id);
      const confidences = has
        ? current.confidences.filter((item) => item !== id)
        : [...current.confidences, id];
      return { ...current, confidences: confidences.length ? confidences : current.confidences };
    });
  }

  async function onImport(file: File) {
    setImportNote("Importing…");
    const body = new FormData();
    body.set("file", file);
    const response = await fetch("/api/import", { method: "POST", body });
    const payload = (await response.json()) as { inserted?: number; error?: string };
    if (!response.ok) {
      setImportNote(payload.error ?? "Import failed");
      return;
    }
    setImportNote(`Imported ${payload.inserted ?? 0} reports.`);
    setReloadKey((value) => value + 1);
  }

  const folded = Math.max(0, rawCount - reports.length);

  return (
    <div className="map-shell relative h-[100dvh] overflow-hidden bg-app text-ink">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-[max(0.6rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-panel px-3 py-2 shadow-sheet">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-bold text-accentink" aria-hidden>
            H
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">HailMap</p>
            <p className="truncate text-xs text-muted">
              {loading ? "Syncing live reports…" : `${filtered.length} shown`}
              {folded > 0 ? ` · ${folded} duplicates folded` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-pressed={theme === "dark"}
          className="rounded-2xl border border-line bg-panel px-3 py-2 text-sm font-medium shadow-sheet"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <Link
          href="/privacy"
          className="rounded-2xl border border-line bg-panel px-3 py-2 text-sm font-medium shadow-sheet"
        >
          Privacy
        </Link>
      </header>

      <div className="absolute inset-0">
        <HailMap
          theme={theme}
          points={points}
          swaths={swaths}
          income={income}
          showPoints={showPoints}
          showSwaths={showSwaths}
          showIncome={showIncome}
          selectedId={selectedId}
          focus={focus}
          frame={frame}
          onSelectReport={(id) => {
            setSelectedId(id);
            setCounty(null);
            setSheetOpen(true);
          }}
          onSelectCounty={(info) => {
            setCounty(info);
            setSelectedId(null);
            setSheetOpen(true);
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-[4.5rem] z-20 flex justify-center px-3 pr-16">
        <div className="pointer-events-auto flex flex-wrap justify-center gap-2">
          <LayerButton on={showPoints} label="Points" onClick={() => setShowPoints((value) => !value)} />
          <LayerButton on={showSwaths} label="Swaths" onClick={() => setShowSwaths((value) => !value)} />
          <LayerButton on={showIncome} label="Income" onClick={() => setShowIncome((value) => !value)} />
        </div>
      </div>

      {stateCounts.length ? (
        <div className="pointer-events-none absolute inset-x-0 top-[7.35rem] z-20 px-3 pr-16">
          <div
            className="pointer-events-auto flex gap-2 overflow-x-auto pb-1"
            role="toolbar"
            aria-label="Jump to state"
          >
            {filter.state ? (
              <button
                type="button"
                onClick={() => setStateFilter("")}
                className="shrink-0 rounded-full border border-line bg-panel px-3 py-1.5 text-sm font-medium shadow-sheet"
              >
                All states
              </button>
            ) : null}
            {stateCounts.map(([code, count]) => {
              const on = filter.state === code;
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setStateFilter(on ? "" : code)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold shadow-sheet ${
                    on ? "bg-accent text-accentink" : "border border-line bg-panel"
                  }`}
                >
                  {code} {count}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="absolute inset-x-3 top-28 z-20 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-muted shadow-sheet">
          {error}
        </p>
      ) : null}

      {!loading && filtered.length === 0 ? (
        <p className="pointer-events-none absolute left-1/2 top-1/3 z-10 -translate-x-1/2 rounded-full bg-panel px-4 py-2 text-sm text-muted shadow-sheet">
          No hail reports in this window.
        </p>
      ) : null}

      <section className="absolute inset-x-0 bottom-0 z-30">
        <div className="mx-auto w-full max-w-3xl rounded-t-3xl border border-line bg-panel shadow-sheet">
          <button
            type="button"
            className="flex w-full flex-col items-center gap-1 px-4 pb-3 pt-2"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen((open) => !open)}
          >
            <span className="h-1.5 w-10 rounded-full bg-line" />
            <span className="text-sm font-semibold">Filters and reports</span>
            <span className="text-xs text-muted">
              {WINDOWS.find((item) => item.hours === filter.hours)?.label}
              {filter.state ? ` · ${filter.state}` : ""} · min {filter.minSize.toFixed(2)} in
            </span>
          </button>
          {sheetOpen ? (
            <div className="max-h-[62dvh] space-y-4 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {selected ? (
                <article className="rounded-2xl border border-line bg-app p-3">
                  <p className="text-sm font-semibold">{placeLabel(selected)}</p>
                  <p className="text-sm text-muted">
                    {selected.sizeIn != null ? `${selected.sizeIn.toFixed(2)} in` : "Size unknown"} ·{" "}
                    {selected.confidence.toUpperCase()} · {formatWhen(selected.occurredAt)}
                  </p>
                  {selected.remark ? <p className="mt-1 text-sm">{selected.remark}</p> : null}
                  {selected.damageTags.length ? (
                    <p className="mt-2 flex flex-wrap gap-1">
                      {selected.damageTags.map((tag) => (
                        <span key={tag} className="rounded-full bg-panel px-2 py-0.5 text-xs text-muted">
                          {tag}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </article>
              ) : null}
              {county ? (
                <article className="rounded-2xl border border-line bg-app p-3 text-sm">
                  <p className="font-semibold">County {county.fips ?? ""}</p>
                  <p className="text-muted">
                    Median household income:{" "}
                    {county.income != null
                      ? county.income.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                      : "not in the ACS cache"}
                  </p>
                </article>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {WINDOWS.map((item) => (
                  <button
                    key={item.hours}
                    type="button"
                    aria-pressed={filter.hours === item.hours}
                    onClick={() => setHours(item.hours)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      filter.hours === item.hours ? "bg-accent text-accentink" : "border border-line"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-muted">Minimum hail size ({filter.minSize.toFixed(2)} in)</span>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={0.25}
                  value={filter.minSize}
                  onChange={(event) =>
                    setFilter((current) => ({ ...current, minSize: Number(event.target.value) }))
                  }
                  className="w-full accent-teal-700"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                {CONFIDENCE_OPTIONS.map((option) => {
                  const on = filter.confidences.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleConfidence(option.id)}
                      className={`rounded-full px-3 py-1.5 text-sm ${on ? "bg-accent text-accentink" : "border border-line text-muted"}`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <label className="block text-sm">
                <span className="mb-1 block text-muted">State</span>
                <input
                  value={filter.state}
                  maxLength={2}
                  placeholder="Any"
                  onChange={(event) => {
                    const state = event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
                    if (state.length === 2 || state.length === 0) setStateFilter(state);
                    else setFilter((current) => ({ ...current, state }));
                  }}
                  className="w-24 rounded-xl border border-line bg-app px-3 py-2 uppercase"
                />
              </label>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Size</p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {[
                    ["#16a34a", "< 1 in"],
                    ["#ca8a04", "1 in"],
                    ["#ea580c", "Golf ball"],
                    ["#dc2626", "Tennis ball"],
                    ["#7c3aed", "Softball"],
                  ].map(([color, label]) => (
                    <span key={label} className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                </div>
                {showIncome ? (
                  <p className="mt-2 text-xs text-muted">
                    Income shading is county median household income (ACS). Lighter blue is lower.
                  </p>
                ) : null}
              </div>

              <label className="block text-sm">
                <span className="mb-1 block font-medium">Import CSV or GeoJSON</span>
                <input
                  type="file"
                  accept=".csv,.json,.geojson,text/csv,application/json,application/geo+json"
                  className="block w-full text-sm text-muted"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onImport(file);
                    event.target.value = "";
                  }}
                />
                {importNote ? <span className="mt-1 block text-xs text-muted">{importNote}</span> : null}
              </label>

              <div className="flex flex-wrap gap-2 text-xs text-muted">
                <FeedPill label="SPC" status={status?.spc} />
                <FeedPill label="IEM" status={status?.iem} />
                <FeedPill label="NWS" status={status?.nws} />
                <FeedPill label="MESH" status={status?.mesh} />
                {syncedAt ? <span>Synced {formatWhen(syncedAt)}</span> : null}
              </div>

              <p className="text-xs text-muted">
                SPC and IEM local storm reports stay under NWS or Spotter, including public and mPING
                reports an office published. Community is only file import and the community webhook.
              </p>

              <ul className="divide-y divide-line">
                {filtered.slice(0, 200).map((report) => (
                  <li key={report.id}>
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-3 py-2 text-left"
                      onClick={() => {
                        setSelectedId(report.id);
                        setCounty(null);
                        setFocus({ lon: report.lon, lat: report.lat, nonce: Date.now() });
                      }}
                    >
                      <span>
                        <span className="block text-sm font-medium">{placeLabel(report)}</span>
                        <span className="block text-xs text-muted">
                          {formatWhen(report.occurredAt)} · {report.confidence}
                        </span>
                      </span>
                      <span className="text-sm font-semibold">
                        {report.sizeIn != null ? `${report.sizeIn.toFixed(2)}″` : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs leading-relaxed text-muted">
                Live points fuse NWS warnings, SPC hail reports, and IEM local storm reports.
                The map opens on 7 days. State buttons jump to that cluster.
                Swaths cluster reports within about 45 km and 3 hours, then draw a buffered hull.
                HailMap does not scrape social networks. Spotter and community reports arrive only
                through webhooks or file import.
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function LayerButton({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm shadow-sheet ${
        on ? "bg-accent text-accentink" : "border border-line bg-panel text-muted"
      }`}
    >
      {label}
    </button>
  );
}

function FeedPill({ label, status }: { label: string; status?: string }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5">
      {label} {status ?? "…"}
    </span>
  );
}
