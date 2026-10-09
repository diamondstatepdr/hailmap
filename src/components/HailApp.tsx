"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AddressHit } from "@/components/AddressSearch";
import AddressSearch from "@/components/AddressSearch";
import AuthDialog from "@/components/AuthDialog";
import type { MapFocus, MapFrame } from "@/components/HailMap";
import MapFilters from "@/components/MapFilters";
import PhotoReportSheet from "@/components/PhotoReportSheet";
import PropertyCard from "@/components/PropertyCard";
import FieldSheet from "@/components/panels/FieldSheet";
import PropertiesPanel from "@/components/panels/PropertiesPanel";
import ReportsPanel, { type SavedReport } from "@/components/panels/ReportsPanel";
import StormsPanel from "@/components/panels/StormsPanel";
import AppShell, { type AppSection } from "@/components/shell/AppShell";
import { confidenceLabel, defaultFilter, HAZARD_OPTIONS } from "@/components/map-shared";
import {
  applyReportFilter,
  emptyWindowMessage,
  formatWhen,
  LIVE_WINDOW_HOURS,
  placeLabel,
  refreshIntervalMs,
  reportsToPointCollection,
  TIME_WINDOWS,
  wantsFreshSync,
  windowPhrase,
} from "@/lib/filters";
import { damageHeatGrid } from "@/lib/heat";
import { hazardOf, magnitudeLabel } from "@/lib/hazard";
import type { PlaceHistory } from "@/lib/place";
import { haversineKm, boundsOf } from "@/lib/geo";
import { reportsToSwaths } from "@/lib/swath";
import type { Confidence } from "@/lib/confidence";
import { OUTLOOK_LEVELS, SIGNIFICANT_COLOR, type ThreatInfo, type ThreatsResponse } from "@/lib/threats";
import type { PinStatus } from "@/lib/field";
import type { HailReport, ReportsResponse, SourceStatus } from "@/lib/types";

const HailMap = dynamic(() => import("@/components/HailMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-app text-sm text-muted">Loading map…</div>,
});

interface WatchItem {
  id: string;
  label: string;
  query: string;
  lat: number;
  lon: number;
  radiusKm: number;
}

interface FieldPin {
  id: string;
  lat: number;
  lon: number;
  status: PinStatus;
  note: string | null;
  photos: Array<{ id: string }>;
}

interface ViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

function readTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export default function HailApp() {
  const [section, setSection] = useState<AppSection>("map");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [reports, setReports] = useState<HailReport[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showPoints, setShowPoints] = useState(true);
  const [showSwaths, setShowSwaths] = useState(true);
  const [showIncome, setShowIncome] = useState(false);
  const [showThreats, setShowThreats] = useState(true);
  const [showOutlook, setShowOutlook] = useState(true);
  const [showHeat, setShowHeat] = useState(false);
  const [income, setIncome] = useState<GeoJSON.FeatureCollection | null>(null);
  const [incomeError, setIncomeError] = useState(false);
  const [threats, setThreats] = useState<GeoJSON.FeatureCollection | null>(null);
  const [threatStatus, setThreatStatus] = useState<ThreatsResponse["status"] | null>(null);
  const [threatError, setThreatError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [county, setCounty] = useState<{ fips?: string; income: number | null } | null>(null);
  const [threat, setThreat] = useState<ThreatInfo | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [frame, setFrame] = useState<MapFrame | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reportOpen, setReportOpen] = useState(false);
  const [draftPin, setDraftPin] = useState<{ lat: number; lon: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState(defaultFilter);
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(15);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [placePoint, setPlacePoint] = useState<{ lat: number; lon: number } | null>(null);
  const [place, setPlace] = useState<PlaceHistory | null>(null);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [pins, setPins] = useState<FieldPin[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [street, setStreet] = useState<string | null>(null);
  const [streetStatus, setStreetStatus] = useState<"idle" | "loading" | "unavailable" | "ok">("idle");
  const [fieldPlace, setFieldPlace] = useState<PlaceHistory | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const lastStreetFix = useRef<{ lat: number; lon: number } | null>(null);
  const refreshMs = refreshIntervalMs(filter.hours);
  const freshSync = wantsFreshSync(filter.hours);

  useEffect(() => {
    setTheme(readTheme());
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((payload: { user?: { id: string; name: string } | null; configured?: boolean }) => {
        setUser(payload.user ?? null);
        setAuthConfigured(Boolean(payload.configured));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) {
      setWatch([]);
      setPins([]);
      setSavedReports([]);
      return;
    }
    fetch("/api/watch")
      .then((response) => response.json())
      .then((payload: { places?: WatchItem[] }) => setWatch(payload.places ?? []))
      .catch(() => undefined);
    fetch("/api/field/pins")
      .then((response) => response.json())
      .then((payload: { pins?: FieldPin[] }) => setPins(payload.pins ?? []))
      .catch(() => undefined);
    fetch("/api/storm-reports")
      .then((response) => response.json())
      .then((payload: { reports?: SavedReport[] }) => setSavedReports(payload.reports ?? []))
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    let running = false;
    async function load() {
      if (running) return;
      running = true;
      try {
        const response = await fetch(freshSync ? "/api/reports?fresh=1" : "/api/reports", { cache: "no-store" });
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
        running = false;
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), refreshMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [reloadKey, refreshMs, freshSync]);

  useEffect(() => {
    if (!showThreats && !showOutlook) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/threats", { cache: "no-store" });
        if (!response.ok) throw new Error("threats failed");
        const payload = (await response.json()) as ThreatsResponse;
        if (cancelled) return;
        setThreats(payload.collection ?? { type: "FeatureCollection", features: [] });
        setThreatStatus(payload.status ?? null);
        setThreatError(false);
      } catch {
        if (!cancelled) setThreatError(true);
      }
    }
    void load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [showThreats, showOutlook, reloadKey]);

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

  useEffect(() => {
    if (section !== "field" || !navigator.geolocation) {
      if (section === "field" && !navigator.geolocation) setGpsError("This browser cannot share location.");
      return;
    }
    setGpsError(null);
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setUserLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
        setGpsError(null);
      },
      () => setGpsError("Location is blocked. Allow location access to drive Field mode."),
      { enableHighAccuracy: true, maximumAge: 8000, timeout: 12000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [section]);

  useEffect(() => {
    if (!placePoint) return;
    let cancelled = false;
    setPlaceLoading(true);
    setPlaceError(null);
    const params = new URLSearchParams({
      lat: String(placePoint.lat),
      lon: String(placePoint.lon),
      radiusKm: String(radiusKm),
      hours: String(filter.hours),
    });
    fetch(`/api/place?${params}`)
      .then(async (response) => {
        const payload = (await response.json()) as PlaceHistory & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load this address");
        if (!cancelled) setPlace(payload);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setPlaceError(reason instanceof Error ? reason.message : "Could not load this address");
      })
      .finally(() => {
        if (!cancelled) setPlaceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [placePoint, radiusKm, filter.hours, reloadKey]);

  const fieldHours = useRef(filter.hours);
  useEffect(() => {
    if (section !== "field") {
      lastStreetFix.current = null;
      return;
    }
    if (!userLocation) return;
    const previous = lastStreetFix.current;
    const sameSpot = previous != null && haversineKm(previous.lat, previous.lon, userLocation.lat, userLocation.lon) < 0.2;
    if (sameSpot && fieldHours.current === filter.hours && fieldPlace) return;
    fieldHours.current = filter.hours;
    lastStreetFix.current = userLocation;
    if (!previous) setFocus({ lon: userLocation.lon, lat: userLocation.lat, nonce: Date.now(), zoom: 13 });
    let cancelled = false;
    setStreetStatus("loading");
    const params = new URLSearchParams({
      lat: String(userLocation.lat),
      lon: String(userLocation.lon),
      radiusKm: "8",
      hours: String(filter.hours),
    });
    fetch(`/api/place?${params}`)
      .then(async (response) => {
        const payload = (await response.json()) as PlaceHistory & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Score unavailable");
        if (!cancelled) {
          setFieldPlace(payload);
          setFieldError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setFieldError(reason instanceof Error ? reason.message : "Score unavailable");
      });
    fetch(`/api/geocode?lat=${userLocation.lat}&lon=${userLocation.lon}`)
      .then((response) => response.json())
      .then((payload: { street?: string | null }) => {
        if (cancelled) return;
        setStreet(payload.street ?? null);
        setStreetStatus(payload.street ? "ok" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setStreetStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [section, userLocation, filter.hours, fieldPlace]);

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
        filtered
          .filter((report) => hazardOf(report.hazard) === "hail")
          .map((report) => ({
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
  const heat = useMemo(
    () => (showHeat ? damageHeatGrid(filtered, { swaths }) : null),
    [showHeat, filtered, swaths],
  );
  const fieldCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: pins.map((pin) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pin.lon, pin.lat] },
        properties: { id: pin.id, status: pin.status },
      })),
    }),
    [pins],
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

  function frameFilter(next: typeof filter) {
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

  function toggleHazard(id: (typeof HAZARD_OPTIONS)[number]["id"]) {
    setFilter((current) => {
      const hazards = current.hazards ?? ["hail", "wind", "tornado"];
      const has = hazards.includes(id);
      const next = has ? hazards.filter((item) => item !== id) : [...hazards, id];
      return { ...current, hazards: next.length ? next : hazards };
    });
  }

  function toggleConfidence(id: Confidence) {
    setFilter((current) => {
      const has = current.confidences.includes(id);
      const confidences = has ? current.confidences.filter((item) => item !== id) : [...current.confidences, id];
      return { ...current, confidences: confidences.length ? confidences : current.confidences };
    });
  }

  function chooseAddress(hit: AddressHit) {
    setPlaceLabel(hit.label);
    setPlacePoint({ lat: hit.lat, lon: hit.lon });
    setFocus({ lon: hit.lon, lat: hit.lat, nonce: Date.now(), zoom: 12 });
    setSelectedId(null);
  }

  async function saveWatch() {
    if (!user || !placePoint || !placeLabel) {
      setAuthOpen(true);
      return;
    }
    const response = await fetch("/api/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: placeLabel, query: placeLabel, lat: placePoint.lat, lon: placePoint.lon, radiusKm }),
    });
    const payload = (await response.json()) as { place?: WatchItem; error?: string };
    if (response.ok && payload.place) setWatch((current) => [payload.place as WatchItem, ...current]);
  }

  async function removeWatch(id: string) {
    const response = await fetch(`/api/watch/${id}`, { method: "DELETE" });
    if (response.ok) setWatch((current) => current.filter((item) => item.id !== id));
  }

  async function markPin(statusPin: PinStatus, note: string) {
    const point = userLocation ?? placePoint;
    if (!point) return;
    const response = await fetch("/api/field/pins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: point.lat, lon: point.lon, status: statusPin, note }),
    });
    const payload = (await response.json()) as { pin?: FieldPin; error?: string };
    if (!response.ok || !payload.pin) return;
    setPins((current) => [payload.pin as FieldPin, ...current]);
    setSelectedPinId(payload.pin.id);
    setFocus({ lon: payload.pin.lon, lat: payload.pin.lat, nonce: Date.now(), zoom: 15 });
  }

  async function uploadFieldPhoto(pinId: string, file: File, damageType: string, note: string) {
    const body = new FormData();
    body.set("photo", file);
    body.set("damageType", damageType);
    body.set("note", note);
    body.set("takenAt", new Date().toISOString());
    const response = await fetch(`/api/field/pins/${pinId}/photos`, { method: "POST", body });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save that photo");
    const refreshed = await fetch("/api/field/pins");
    const list = (await refreshed.json()) as { pins?: FieldPin[] };
    setPins(list.pins ?? []);
  }

  async function generateReport(kind: "address" | "view") {
    setReportBusy(true);
    setReportError(null);
    try {
      const body =
        kind === "address" && placePoint && placeLabel
          ? { label: placeLabel, lat: placePoint.lat, lon: placePoint.lon, radiusKm, hours: filter.hours }
          : viewBounds
            ? { label: "Map view", bounds: viewBounds, hours: filter.hours }
            : null;
      if (!body) throw new Error(kind === "address" ? "Search an address first." : "Open the map so a view can be saved.");
      const response = await fetch("/api/storm-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { url?: string; error?: string; report?: { title: string; id: string; createdAt: string } };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? "Could not build that report");
      setReportUrl(payload.url);
      if (payload.report && user) {
        setSavedReports((current) => [
          { id: payload.report?.id ?? "", title: payload.report?.title ?? "Storm report", createdAt: payload.report?.createdAt ?? new Date().toISOString() },
          ...current,
        ]);
      }
    } catch (reason) {
      setReportError(reason instanceof Error ? reason.message : "Could not build that report");
    } finally {
      setReportBusy(false);
    }
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

  function onPhotoSubmitted(report: HailReport) {
    setReports((current) => [report, ...current.filter((item) => item.id !== report.id)]);
    setRawCount((count) => count + 1);
    setFilter((current) => ({
      ...current,
      minSize: report.sizeIn != null && report.sizeIn < current.minSize ? 0 : current.minSize,
      state: current.state && (report.state ?? "").toUpperCase() !== current.state ? "" : current.state,
      confidences: current.confidences.includes("community") ? current.confidences : [...current.confidences, "community"],
    }));
    setSelectedId(report.id);
    setFocus({ lon: report.lon, lat: report.lat, nonce: Date.now(), zoom: 11 });
    setSection("map");
    setReportOpen(false);
    setPicking(false);
    setDraftPin(null);
    setReloadKey((value) => value + 1);
  }

  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    setUser(null);
  }

  const folded = Math.max(0, rawCount - reports.length);
  const hazards = filter.hazards ?? ["hail", "wind", "tornado"];
  const showMap = section === "map" || section === "field";
  const hasSignificant = Boolean(threats?.features.some((feature) => feature.properties?.kind === "significant"));

  return (
    <AppShell
      section={section}
      onSection={setSection}
      theme={theme}
      onToggleTheme={toggleTheme}
      userName={user?.name ?? null}
      authConfigured={authConfigured}
      onSignIn={() => setAuthOpen(true)}
      onSignOut={() => void signOut()}
    >
      {showMap ? (
        <div className="absolute inset-0">
          <HailMap
            theme={theme}
            points={points}
            swaths={swaths}
            income={income}
            threats={threats}
            showPoints={showPoints}
            showSwaths={showSwaths}
            showIncome={showIncome}
            showThreats={showThreats}
            showOutlook={showOutlook}
            showHeat={showHeat}
            heat={heat}
            userLocation={section === "field" ? userLocation : null}
            fieldPins={user ? fieldCollection : null}
            selectedId={selectedId}
            focus={focus}
            frame={frame}
            draftPin={draftPin}
            pickMode={picking}
            blockSelection={reportOpen}
            onPickLocation={(lon, lat) => setDraftPin({ lat, lon })}
            onSelectReport={(id) => {
              setSelectedId(id);
              setCounty(null);
              setThreat(null);
            }}
            onSelectFieldPin={(id) => {
              setSelectedPinId(id);
              setSection("field");
            }}
            onSelectCounty={(info) => {
              setCounty(info);
              setSelectedId(null);
              setThreat(null);
            }}
            onSelectThreat={(info) => {
              setThreat(info);
              setSelectedId(null);
              setCounty(null);
            }}
            onViewChange={setViewBounds}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 space-y-2 px-3 pt-[max(0.55rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto flex items-start gap-2">
              <AddressSearch onPick={chooseAddress} />
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="rounded-2xl border border-line bg-panel px-3 py-2 text-sm font-semibold shadow-sheet"
              >
                Filters
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="rounded-2xl border border-line bg-panel px-3 py-2 text-sm font-medium shadow-sheet md:hidden"
              >
                {theme === "dark" ? "Light" : "Dark"}
              </button>
            </div>
            <div className="pointer-events-auto flex gap-2" role="group" aria-label="Hazards">
              {HAZARD_OPTIONS.map((option) => {
                const on = hazards.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleHazard(option.id)}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold shadow-sheet ${
                      on ? "bg-accent text-accentink" : "border border-line bg-panel text-muted"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-auto flex gap-1 overflow-x-auto" role="group" aria-label="Time window">
              {TIME_WINDOWS.map((item) => (
                <button
                  key={item.hours}
                  type="button"
                  aria-pressed={filter.hours === item.hours}
                  onClick={() => setHours(item.hours)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm shadow-sheet ${
                    filter.hours === item.hours ? "bg-accent font-semibold text-accentink" : "border border-line bg-panel"
                  }`}
                >
                  {item.hours === LIVE_WINDOW_HOURS ? "Live" : item.label}
                </button>
              ))}
            </div>
          </div>
          {stateCounts.length ? (
            <div className="map-state-jumps pointer-events-none absolute inset-x-0 z-20 px-3">
              <div className="pointer-events-auto flex gap-2 overflow-x-auto" role="toolbar" aria-label="Jump to a state">
                {stateCounts.slice(0, 12).map(([code, count]) => {
                  const on = filter.state === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStateFilter(on ? "" : code)}
                      className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold shadow-sheet ${
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
            <p className="map-banner absolute inset-x-3 z-20 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-muted shadow-sheet">
              {error}
            </p>
          ) : null}
          {showOutlook && !reportOpen && section === "map" && !place && !selected && !threat ? (
            <div className="map-legend pointer-events-none absolute inset-x-3 z-20 flex justify-start">
              <div className="pointer-events-auto inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-panel px-3 py-2 text-xs shadow-sheet">
                <span className="font-semibold">Day 1</span>
                {OUTLOOK_LEVELS.map((level) => (
                  <span key={level.category} className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: level.fill }} />
                    {level.label}
                  </span>
                ))}
                {hasSignificant ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm border-2 border-dashed" style={{ borderColor: SIGNIFICANT_COLOR }} />
                    Significant
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {!loading && filtered.length === 0 && !reportOpen ? (
            <p className="pointer-events-none absolute left-1/2 top-1/3 z-10 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl bg-panel px-4 py-3 text-center text-sm text-muted shadow-sheet">
              {hazards.length === 1 && hazards[0] === "hail" ? emptyWindowMessage(filter.hours) : `No reports in ${windowPhrase(filter.hours).toLowerCase()}.`}
            </p>
          ) : null}
          {section === "map" && place && placeLabel ? (
            <div className="absolute inset-x-3 bottom-3 z-30 max-h-[48%] overflow-y-auto">
              <PropertyCard
                label={placeLabel}
                history={place}
                mesh={status?.mesh}
                onClose={() => {
                  setPlace(null);
                  setPlacePoint(null);
                }}
                onSave={() => void saveWatch()}
                onReport={() => {
                  setSection("reports");
                  void generateReport("address");
                }}
              />
            </div>
          ) : null}
          {section === "map" && !place && (selected || threat || county) ? (
            <div className="absolute inset-x-3 bottom-3 z-30">
              <article className="rounded-3xl border border-line bg-panel p-4 shadow-sheet">
                {selected ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                      {hazardOf(selected.hazard)} · {selected.photoUrl ? "Community photo" : confidenceLabel(selected.confidence)}
                    </p>
                    <p className="text-base font-semibold">{placeLabelOf(selected)}</p>
                    <p className="text-sm text-muted">
                      {magnitudeLabel(selected)} · {formatWhen(selected.occurredAt)}
                    </p>
                    {selected.photoUrl ? (
                      <img src={selected.photoUrl} alt="Community hail photo" className="mt-2 max-h-40 w-full rounded-xl object-cover" />
                    ) : null}
                    {selected.remark ? <p className="mt-2 text-sm">{selected.remark}</p> : null}
                  </>
                ) : null}
                {threat ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-accent">{threat.event}</p>
                    {threat.hazard ? <p className="mt-1 text-sm">{threat.hazard}</p> : null}
                  </>
                ) : null}
                {county ? (
                  <p className="text-sm">
                    Median household income{" "}
                    {county.income != null
                      ? county.income.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                      : "is not in the ACS cache"}
                  </p>
                ) : null}
              </article>
            </div>
          ) : null}
          {section === "field" ? (
            <div className="absolute inset-x-0 bottom-0 z-30">
              <FieldSheet
                gpsError={gpsError}
                street={street}
                streetStatus={streetStatus}
                history={fieldPlace}
                historyError={fieldError}
                signedIn={Boolean(user)}
                pins={pins}
                selectedPinId={selectedPinId}
                onSignIn={() => setAuthOpen(true)}
                onMark={(statusPin, note) => void markPin(statusPin, note)}
                onSelectPin={(id) => {
                  setSelectedPinId(id);
                  const pin = pins.find((item) => item.id === id);
                  if (pin) setFocus({ lon: pin.lon, lat: pin.lat, nonce: Date.now(), zoom: 16 });
                }}
                onUpload={uploadFieldPhoto}
              />
            </div>
          ) : null}
          {filtersOpen ? (
            <MapFilters
              filter={filter}
              onFilter={(next) => {
                const stateChanged = next.state !== filter.state && (next.state.length === 2 || next.state.length === 0);
                setFilter(next);
                if (stateChanged) frameFilter(next);
              }}
              onToggleConfidence={toggleConfidence}
              showPoints={showPoints}
              showSwaths={showSwaths}
              showThreats={showThreats}
              showOutlook={showOutlook}
              showIncome={showIncome}
              showHeat={showHeat}
              onToggle={(key) => {
                if (key === "points") setShowPoints((value) => !value);
                if (key === "swaths") setShowSwaths((value) => !value);
                if (key === "threats") setShowThreats((value) => !value);
                if (key === "outlook") setShowOutlook((value) => !value);
                if (key === "income") setShowIncome((value) => !value);
                if (key === "heat") setShowHeat((value) => !value);
              }}
              incomeError={incomeError}
              threatError={threatError}
              threatStatus={threatStatus}
              status={status}
              syncedAt={syncedAt}
              folded={folded}
              importNote={importNote}
              onImport={(file) => void onImport(file)}
              onCommunityPhoto={() => {
                setFiltersOpen(false);
                setDraftPin(null);
                setReportOpen(true);
              }}
              onClose={() => setFiltersOpen(false)}
            />
          ) : null}
          {reportOpen ? (
            <PhotoReportSheet
              pin={draftPin}
              onPinChange={setDraftPin}
              onPickingChange={setPicking}
              onFocus={setFocus}
              onClose={() => {
                setReportOpen(false);
                setPicking(false);
                setDraftPin(null);
              }}
              onSubmitted={onPhotoSubmitted}
            />
          ) : null}
          {loading ? (
            <p className="pointer-events-none absolute left-3 top-36 z-10 rounded-full bg-panel px-3 py-1 text-xs text-muted shadow-sheet">
              Loading reports…
            </p>
          ) : null}
        </div>
      ) : null}
      {section === "storms" ? (
        <StormsPanel
          loading={loading}
          error={error}
          reports={filtered}
          filter={filter}
          status={status}
          syncedAt={syncedAt}
          onSelect={(report) => {
            setSelectedId(report.id);
            setPlace(null);
            setFocus({ lon: report.lon, lat: report.lat, nonce: Date.now(), zoom: 10 });
            setSection("map");
          }}
        />
      ) : null}
      {section === "properties" ? (
        <PropertiesPanel
          radiusKm={radiusKm}
          hours={filter.hours}
          onRadius={setRadiusKm}
          onHours={setHours}
          onSearch={chooseAddress}
          history={place}
          label={placeLabel}
          loading={placeLoading}
          error={placeError}
          mesh={status?.mesh ?? null}
          signedIn={Boolean(user)}
          watch={watch}
          onSave={() => void saveWatch()}
          onOpenWatch={(item) => {
            setRadiusKm(item.radiusKm);
            chooseAddress({ label: item.label, lat: item.lat, lon: item.lon, city: null, state: null });
          }}
          onRemoveWatch={(id) => void removeWatch(id)}
          onReport={() => {
            setSection("reports");
            void generateReport("address");
          }}
          onShowMap={() => setSection("map")}
        />
      ) : null}
      {section === "reports" ? (
        <ReportsPanel
          canUseView={Boolean(viewBounds)}
          hasPlace={Boolean(placePoint && placeLabel)}
          placeLabel={placeLabel}
          busy={reportBusy}
          error={reportError}
          lastUrl={reportUrl}
          saved={savedReports}
          signedIn={Boolean(user)}
          onAddress={() => void generateReport("address")}
          onView={() => void generateReport("view")}
        />
      ) : null}
      {authOpen ? (
        <AuthDialog
          configured={authConfigured}
          onClose={() => setAuthOpen(false)}
          onSignedIn={(next) => {
            setUser(next);
            setAuthOpen(false);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function placeLabelOf(report: HailReport): string {
  return report.location || report.county || report.state
    ? placeLabel(report)
    : `${report.lat.toFixed(3)}, ${report.lon.toFixed(3)}`;
}
