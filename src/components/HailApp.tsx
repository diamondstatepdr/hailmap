"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CloudHail, Gem, Moon, SlidersHorizontal, SunMedium, Tornado, Wind } from "lucide-react";
import type { AddressHit } from "@/components/AddressSearch";
import AddressSearch from "@/components/AddressSearch";
import AuthDialog from "@/components/AuthDialog";
import type { MapFocus, MapFrame } from "@/components/HailMap";
import MapFilters from "@/components/MapFilters";
import PhotoReportSheet from "@/components/PhotoReportSheet";
import AddressHistoryCard, { type AddressHistoryView } from "@/components/AddressHistoryCard";
import PropertyCard from "@/components/PropertyCard";
import AlertHereSheet from "@/components/alerts/AlertHereSheet";
import FieldSheet from "@/components/panels/FieldSheet";
import AlertsPanel from "@/components/panels/AlertsPanel";
import PropertiesPanel from "@/components/panels/PropertiesPanel";
import ReportsPanel, { type SavedReport } from "@/components/panels/ReportsPanel";
import HoneyPanel, { type HoneyMode, type HoneySpotView } from "@/components/panels/HoneyPanel";
import StormsPanel from "@/components/panels/StormsPanel";
import AppShell, { type AppSection } from "@/components/shell/AppShell";
import { confidenceLabel, defaultFilter, HAZARD_OPTIONS } from "@/components/map-shared";
import type { AreaSelection, DealerPin, RadarSample } from "@/lib/area-selection";
import { MESH_LEGEND } from "@/lib/mesh-legend";
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
import HailCalendar, { type CalendarMark } from "@/components/HailCalendar";
import { HISTORY_CHIPS, formatDay, lastDays, type DateSpan } from "@/lib/history-range";
import { damageHeatGrid } from "@/lib/heat";
import { hazardOf, magnitudeLabel } from "@/lib/hazard";
import type { PlaceHistory } from "@/lib/place";
import { parseAlertLink } from "@/lib/alert-model";
import { haversineKm, boundsOf } from "@/lib/geo";
import { reportsToSwaths } from "@/lib/swath";
import type { Confidence } from "@/lib/confidence";
import { OUTLOOK_LEVELS, SIGNIFICANT_COLOR, type ThreatInfo, type ThreatsResponse } from "@/lib/threats";
import type { PinStatus } from "@/lib/field";
import type { HailReport, ReportsResponse, SourceStatus } from "@/lib/types";

const HailMap = dynamic(() => import("@/components/HailMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-app text-sm text-muted">
      <div className="w-56 space-y-2" aria-busy="true">
        <span className="sr-only">Loading map…</span>
        <div className="skeleton mx-auto h-10 w-10 rounded-2xl" />
        <div className="skeleton h-3" />
        <div className="skeleton h-3 w-2/3" />
      </div>
    </div>
  ),
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

type HistoryMode =
  | { kind: "window" }
  | { kind: "days"; days: number }
  | { kind: "custom"; start: string; end: string }
  | { kind: "day"; date: string };

interface HoneyResponse {
  label?: string;
  partial?: boolean;
  zoom?: boolean;
  note?: string | null;
  attribution?: string;
  error?: string;
  spots?: { pdr: HoneySpotView[]; roof: HoneySpotView[] };
  heat?: { pdr: GeoJSON.FeatureCollection; roof: GeoJSON.FeatureCollection };
}

interface HailDayView {
  date: string;
  maxHailIn: number | null;
  hailCount: number;
  windCount: number;
  tornadoCount: number;
  meshMaxIn: number | null;
}

function modeSpan(mode: HistoryMode, hours: number): DateSpan | null {
  if (mode.kind === "days") return lastDays(mode.days);
  if (mode.kind === "custom") return { start: mode.start, end: mode.end };
  if (mode.kind === "day") return { start: mode.date, end: mode.date };
  if (hours >= 24) return lastDays(Math.max(1, Math.round(hours / 24)));
  return lastDays(1);
}

function clusterReport(cluster: {
  lat: number;
  lon: number;
  count: number;
  hailCount: number;
  windCount: number;
  tornadoCount: number;
  maxHailIn: number | null;
  maxWindMph: number | null;
  strongestTornado: string | null;
  occurredAt: string;
  stormDate: string;
  state?: string | null;
}): HailReport {
  const hazard = cluster.hailCount ? "hail" : cluster.tornadoCount ? "tornado" : "wind";
  return {
    id: `c:${cluster.lat.toFixed(3)}:${cluster.lon.toFixed(3)}`,
    source: "spc",
    confidence: "nws",
    hazard,
    lat: cluster.lat,
    lon: cluster.lon,
    sizeIn: cluster.maxHailIn,
    sizeRaw: null,
    windMph: cluster.maxWindMph,
    efRating: cluster.strongestTornado,
    occurredAt: cluster.occurredAt || `${cluster.stormDate}T18:00:00.000Z`,
    location: `${cluster.count} reports`,
    county: null,
    state: cluster.state ?? null,
    remark: null,
    damageTags: [],
    clusterCount: cluster.count,
  };
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
  const [honeyOpen, setHoneyOpen] = useState(false);
  const [honeyMode, setHoneyMode] = useState<HoneyMode>("pdr");
  const [showHoney, setShowHoney] = useState(false);
  const [honey, setHoney] = useState<HoneyResponse | null>(null);
  const [honeyLoading, setHoneyLoading] = useState(false);
  const [honeyError, setHoneyError] = useState<string | null>(null);
  const [selectedHoneyId, setSelectedHoneyId] = useState<string | null>(null);
  const [showMesh, setShowMesh] = useState(true);
  const [meshDate, setMeshDate] = useState("");
  const [historyMode, setHistoryMode] = useState<HistoryMode>({ kind: "window" });
  const [serverClusters, setServerClusters] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getUTCFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getUTCMonth() + 1);
  const [calendarMarks, setCalendarMarks] = useState<CalendarMark[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [chromePx, setChromePx] = useState(0);
  const [hailDaysOpen, setHailDaysOpen] = useState(false);
  const [hailDays, setHailDays] = useState<HailDayView[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [addressSpanId, setAddressSpanId] = useState("2y");
  const [addressHistory, setAddressHistory] = useState<AddressHistoryView | null>(null);
  const [scoreDate, setScoreDate] = useState<string | null>(null);
  const [addressTick, setAddressTick] = useState(0);
  const [meshCollection, setMeshCollection] = useState<GeoJSON.FeatureCollection | null>(null);
  const [meshLabel, setMeshLabel] = useState<string | null>(null);
  const [meshNote, setMeshNote] = useState<string | null>(null);
  const [meshLoading, setMeshLoading] = useState(false);
  const [area, setArea] = useState<AreaSelection | null>(null);
  const [dealers, setDealers] = useState<DealerPin[]>([]);
  const [dealerNote, setDealerNote] = useState<string | null>(null);
  const [dealerError, setDealerError] = useState<string | null>(null);
  const [dealerLoading, setDealerLoading] = useState(false);
  const [selectedDealerId, setSelectedDealerId] = useState<string | null>(null);
  const [radar, setRadar] = useState<RadarSample | null>(null);
  const [radarLoading, setRadarLoading] = useState(false);
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
  const [placeCardOpen, setPlaceCardOpen] = useState(false);
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
  const viewBoundsRef = useRef<ViewBounds | null>(null);
  const [rankBounds, setRankBounds] = useState<ViewBounds | null>(null);
  const holdRankUntil = useRef(0);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const lastStreetFix = useRef<{ lat: number; lon: number } | null>(null);
  const pendingReport = useRef<string | null>(null);
  const [alertDraft, setAlertDraft] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const placePointRef = useRef(placePoint);
  placePointRef.current = placePoint;
  const meshFrameKey = useRef<string | null>(null);
  const lockFrame = useRef(false);
  const historyActive = historyMode.kind !== "window";
  const historyActiveRef = useRef(false);
  historyActiveRef.current = historyActive;
  const addressRetries = useRef(0);
  const calendarCache = useRef(new Map<string, CalendarMark[]>());
  const chromeRef = useRef<HTMLDivElement>(null);
  const refreshMs = refreshIntervalMs(filter.hours);
  const freshSync = wantsFreshSync(filter.hours);

  function followAlertLink(href: string) {
    const target = parseAlertLink(href);
    if (target.focus) {
      setFocus({ lat: target.focus.lat, lon: target.focus.lon, zoom: target.focus.zoom, nonce: Date.now() });
      setSection("map");
    }
    if (target.reportId) {
      pendingReport.current = target.reportId;
      setSelectedId(target.reportId);
      setSection("map");
    }
    if (target.card) {
      setPlaceLabel(target.card.label);
      setPlacePoint({ lat: target.card.lat, lon: target.card.lon });
      setPlace(null);
      setPlaceCardOpen(true);
      setSection("map");
      if (!target.focus) {
        setFocus({ lat: target.card.lat, lon: target.card.lon, zoom: 11, nonce: Date.now() });
      }
    } else if (target.section === "alerts" && !target.focus) {
      setSection("alerts");
    }
  }

  useEffect(() => {
    followAlertLink(window.location.href);
    const params = new URL(window.location.href).searchParams;
    if (params.get("theme") === "dark") {
      document.documentElement.classList.add("dark");
      document.documentElement.style.colorScheme = "dark";
      localStorage.setItem("hailmap-theme", "dark");
    } else if (params.get("theme") === "light") {
      document.documentElement.classList.remove("dark");
      document.documentElement.style.colorScheme = "light";
      localStorage.setItem("hailmap-theme", "light");
    }
    if (params.get("honey") === "1") {
      const day = params.get("day");
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
        setHistoryMode({ kind: "day", date: day });
        setMeshDate(day);
        setScoreDate(day);
      }
      const west = Number(params.get("west"));
      const south = Number(params.get("south"));
      const east = Number(params.get("east"));
      const north = Number(params.get("north"));
      if ([west, south, east, north].every((value) => Number.isFinite(value)) && south < north && west < east) {
        lockFrame.current = true;
        setFrame({ west, south, east, north, nonce: Date.now(), maxZoom: 11.5 });
      }
      const mode = params.get("mode");
      if (mode === "roof" || mode === "pdr") setHoneyMode(mode);
      if (params.get("heat") === "1") setShowHoney(true);
      setHoneyOpen(true);
      setSection("map");
      setCalendarOpen(false);
    }
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "hailmap-open" && typeof data.url === "string") followAlertLink(data.url);
      if (data.type === "hailmap-push") window.dispatchEvent(new CustomEvent("hailmap-push"));
    }
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
    // The deep link is read once, when the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pendingReport.current) return;
    if (reports.some((report) => report.id === pendingReport.current)) setSelectedId(pendingReport.current);
  }, [reports]);

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
        if (!historyActiveRef.current) {
          setReports(payload.reports ?? []);
          setRawCount(payload.rawCount ?? payload.reports?.length ?? 0);
          setServerClusters(false);
        }
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
    });
    if (addressSpanId === "max") {
      params.set("start", "1950-01-01");
      params.set("end", new Date().toISOString().slice(0, 10));
    } else {
      const years = addressSpanId === "1y" ? 1 : addressSpanId === "5y" ? 5 : addressSpanId === "10y" ? 10 : 2;
      params.set("years", String(years));
    }
    if (scoreDate) params.set("scoreDate", scoreDate);
    fetch(`/api/history/place?${params}`)
      .then(async (response) => {
        const payload = (await response.json()) as AddressHistoryView & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Could not load this address");
        if (!cancelled) {
          setAddressHistory(payload);
          setPlaceCardOpen(true);
          if (payload.events.some((event) => event.meshStatus === "pending") && addressRetries.current < 5) {
            addressRetries.current += 1;
            window.setTimeout(() => {
              if (!cancelled) setAddressTick((value) => value + 1);
            }, 1200);
          }
        }
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
  }, [placePoint, radiusKm, addressSpanId, scoreDate, addressTick]);

  useEffect(() => {
    if (!placePoint) {
      setRadar(null);
      return;
    }
    let cancelled = false;
    setRadarLoading(true);
    const params = new URLSearchParams({
      lat: String(placePoint.lat),
      lon: String(placePoint.lon),
      hours: String(filter.hours),
    });
    if (meshDate) params.set("date", meshDate);
    fetch(`/api/mesh/at?${params}`)
      .then(async (response) => {
        const payload = (await response.json()) as RadarSample & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Radar hail is unavailable");
        if (!cancelled) setRadar(payload);
      })
      .catch(() => {
        if (!cancelled) setRadar(null);
      })
      .finally(() => {
        if (!cancelled) setRadarLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [placePoint, filter.hours, meshDate]);

  useEffect(() => {
    if (!showMesh) return;
    const controller = new AbortController();
    setMeshLoading(true);
    const params = new URLSearchParams();
    if (historyMode.kind === "days" || historyMode.kind === "custom") {
      setMeshCollection({ type: "FeatureCollection", features: [] });
      setMeshLabel("Pick a hail day");
      setMeshNote("Radar swaths load one convective day at a time. Open Hail days and tap a date.");
      setMeshLoading(false);
      return;
    }
    if (meshDate) params.set("date", meshDate);
    else params.set("hours", String(filter.hours));
    fetch(`/api/mesh?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as {
          collection?: GeoJSON.FeatureCollection;
          label?: string;
          note?: string;
          bounds?: { west: number; south: number; east: number; north: number } | null;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error ?? "Radar hail is unavailable");
        setMeshCollection(payload.collection ?? { type: "FeatureCollection", features: [] });
        setMeshLabel(payload.label ?? null);
        setMeshNote(payload.note ?? null);
        const key = `${meshDate}|${filter.hours}|${payload.label ?? ""}`;
        if (payload.bounds && meshFrameKey.current !== key && !placePointRef.current && !lockFrame.current) {
          meshFrameKey.current = key;
          setFrame({ ...payload.bounds, nonce: Date.now(), maxZoom: 9.5 });
        }
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setMeshNote("Radar hail is unavailable right now.");
        setMeshCollection({ type: "FeatureCollection", features: [] });
      })
      .finally(() => {
        if (!controller.signal.aborted) setMeshLoading(false);
      });
    return () => controller.abort();
  }, [showMesh, filter.hours, meshDate, historyMode]);

  useEffect(() => {
    if (!historyActive) return;
    const span = modeSpan(historyMode, filter.hours);
    const bounds = viewBounds;
    if (!span || !bounds) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        start: span.start,
        end: span.end,
        west: String(bounds.west),
        south: String(bounds.south),
        east: String(bounds.east),
        north: String(bounds.north),
      });
      if (filter.state) params.set("state", filter.state);
      setHistoryLoading(true);
      fetch(`/api/history/reports?${params}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as {
            error?: string;
            mode?: "points" | "clusters";
            reports?: HailReport[];
            clusters?: Parameters<typeof clusterReport>[0][];
            total?: number;
            pendingDays?: number;
          };
          if (!response.ok) throw new Error(payload.error ?? "Storm history is unavailable");
          if (controller.signal.aborted) return;
          if (payload.mode === "clusters") {
            setReports((payload.clusters ?? []).map(clusterReport));
            setServerClusters(true);
          } else {
            setReports(payload.reports ?? []);
            setServerClusters(false);
          }
          setRawCount(payload.total ?? payload.reports?.length ?? 0);
          setHistoryNote(payload.pendingDays ? `Indexing ${payload.pendingDays} recent days in the background.` : null);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setError(reason instanceof Error ? reason.message : "Storm history is unavailable");
        })
        .finally(() => {
          if (!controller.signal.aborted) setHistoryLoading(false);
        });
    }, 320);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [historyActive, historyMode, viewBounds, filter.state, filter.hours]);

  useEffect(() => {
    if (!hailDaysOpen) return;
    const span = modeSpan(historyMode, filter.hours);
    const bounds = viewBounds;
    if (!span || !bounds) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      start: span.start,
      end: span.end,
      west: String(bounds.west),
      south: String(bounds.south),
      east: String(bounds.east),
      north: String(bounds.north),
    });
    if (filter.state) params.set("state", filter.state);
    fetch(`/api/history/days?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as { days?: HailDayView[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Hail days are unavailable");
        if (!controller.signal.aborted) setHailDays(payload.days ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHailDays([]);
      });
    return () => controller.abort();
  }, [hailDaysOpen, historyMode, viewBounds, filter.state, filter.hours]);

  useEffect(() => {
    if (!calendarOpen || !viewBounds) return;
    const today = new Date().toISOString().slice(0, 10);
    const start = `${calendarYear}-01-01`;
    const end = `${calendarYear}-12-31` > today ? today : `${calendarYear}-12-31`;
    if (start > end) return;
    const key = [calendarYear, viewBounds.west.toFixed(2), viewBounds.south.toFixed(2), viewBounds.east.toFixed(2), viewBounds.north.toFixed(2), filter.state].join("|");
    const cached = calendarCache.current.get(key);
    if (cached) {
      setCalendarMarks(cached);
      setCalendarLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        start,
        end,
        west: String(viewBounds.west),
        south: String(viewBounds.south),
        east: String(viewBounds.east),
        north: String(viewBounds.north),
      });
      if (filter.state) params.set("state", filter.state);
      setCalendarLoading(true);
      fetch(`/api/history/days?${params}`, { signal: controller.signal })
        .then(async (response) => {
          const payload = (await response.json()) as { days?: HailDayView[]; error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Hail days are unavailable");
          if (controller.signal.aborted) return;
          const marks = (payload.days ?? []).flatMap((day) => {
            const inches = Math.max(day.maxHailIn ?? 0, day.meshMaxIn ?? 0);
            return inches > 0 ? [{ date: day.date, inches }] : [];
          });
          calendarCache.current.set(key, marks);
          setCalendarMarks(marks);
        })
        .catch(() => {
          if (!controller.signal.aborted) setCalendarMarks([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setCalendarLoading(false);
        });
    }, 320);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [calendarOpen, calendarYear, viewBounds, filter.state]);

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

  const filtered = useMemo(
    () => applyReportFilter(reports, filter, Date.now(), { ignoreTime: historyActive }),
    [reports, filter, historyActive],
  );
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
  const dealerCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: dealers.map((dealer) => ({
        type: "Feature",
        id: dealer.id,
        geometry: { type: "Point", coordinates: [dealer.lon, dealer.lat] },
        properties: { id: dealer.id, name: dealer.name, kind: dealer.kind },
      })),
    }),
    [dealers],
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
    if (meta) meta.setAttribute("content", next === "dark" ? "#0b111a" : "#eef3f8");
  }

  function frameFilter(next: typeof filter) {
    const bounds = boundsOf(applyReportFilter(reports, next));
    if (!bounds) return;
    setFrame({ ...bounds, nonce: Date.now() });
  }

  function showLiveWindow(hours: number) {
    historyActiveRef.current = false;
    setHistoryMode({ kind: "window" });
    setServerClusters(false);
    setHistoryNote(null);
    setMeshDate("");
    setCustomOpen(false);
    const next = { ...filter, hours };
    setFilter(next);
    setReloadKey((value) => value + 1);
    frameFilter(next);
  }

  function showHistoryDays(days: number) {
    setHistoryMode({ kind: "days", days });
    setMeshDate("");
    setCustomOpen(false);
    setHailDaysOpen(true);
  }

  function showCalendar() {
    const seed = historyMode.kind === "day" ? historyMode.date : meshDate || new Date().toISOString().slice(0, 10);
    const [year, month] = seed.split("-").map(Number);
    if (year && month) {
      setCalendarYear(year);
      setCalendarMonth(month);
    }
    setCalendarOpen((open) => !open);
  }

  function pickStormDay(date: string) {
    setHistoryMode({ kind: "day", date });
    setMeshDate(date);
    setCustomOpen(false);
    const [year, month] = date.split("-").map(Number);
    if (year && month) {
      setCalendarYear(year);
      setCalendarMonth(month);
    }
    setScoreDate(date);
  }

  function setHours(hours: number) {
    showLiveWindow(hours);
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
    setPlace(null);
    setAddressHistory(null);
    setScoreDate(null);
    addressRetries.current = 0;
    setPlaceCardOpen(true);
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

  async function loadDealers(selection: AreaSelection) {
    setArea(selection);
    setDealerLoading(true);
    setDealerError(null);
    setDealerNote(null);
    setSelectedDealerId(null);
    try {
      const near = userLocation ?? placePoint;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 55000);
      let response: Response;
      try {
        response = await fetch("/api/dealers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ geometry: selection.geometry, near }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new Error("Dealer search timed out. Try again.");
        }
        throw error;
      } finally {
        window.clearTimeout(timer);
      }
      const payload = (await response.json()) as { dealers?: DealerPin[]; note?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not search dealerships. Try again.");
      setDealers(payload.dealers ?? []);
      setDealerNote(payload.note ?? null);
    } catch (reason) {
      setDealers([]);
      setDealerError(reason instanceof Error ? reason.message : "Could not search dealerships");
    } finally {
      setDealerLoading(false);
    }
  }

  function searchVisibleArea() {
    const bounds = viewBoundsRef.current ?? viewBounds;
    if (!bounds) return;
    const { west, south, east, north } = bounds;
    const span = haversineKm(south, west, north, east);
    if (span > 500) {
      setDealerError("Zoom in to a hail area first. Dealer search stays under about 500 km.");
      setDealers([]);
      return;
    }
    void loadDealers({
      id: "view",
      label: "Visible map",
      source: "view",
      minIn: null,
      maxIn: null,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
    });
  }

  async function generateReport(kind: "address" | "view") {
    setReportBusy(true);
    setReportError(null);
    try {
      const body =
        kind === "address" && placePoint && placeLabel
          ? {
              label: placeLabel,
              lat: placePoint.lat,
              lon: placePoint.lon,
              radiusKm,
              hours: filter.hours,
              ...(addressHistory ? { start: addressHistory.start, end: addressHistory.end, scoreDate: addressHistory.selectedDate } : {}),
            }
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

  const honeyQuery = useMemo(() => {
    const bounds = rankBounds ?? viewBounds;
    if (!bounds) return "";
    const day = historyMode.kind === "day" ? historyMode.date : meshDate;
    const liveHours = !day && historyMode.kind === "window" && filter.hours <= 24 ? filter.hours : null;
    if (!day && liveHours == null) return "";
    const params = new URLSearchParams({
      west: bounds.west.toFixed(2),
      south: bounds.south.toFixed(2),
      east: bounds.east.toFixed(2),
      north: bounds.north.toFixed(2),
    });
    if (day) params.set("date", day);
    else if (liveHours != null) params.set("hours", String(liveHours));
    const originLat = userLocation?.lat ?? (bounds.south + bounds.north) / 2;
    const originLon = userLocation?.lon ?? (bounds.west + bounds.east) / 2;
    params.set("lat", originLat.toFixed(4));
    params.set("lon", originLon.toFixed(4));
    return params.toString();
  }, [rankBounds, viewBounds, historyMode, meshDate, filter.hours, userLocation]);

  const honeyCollection = useMemo(() => {
    const collection = honey?.heat?.[honeyMode];
    if (!showHoney || !collection) return null;
    return {
      type: "FeatureCollection" as const,
      features: collection.features.map((feature) => ({
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          selected: feature.properties?.id === selectedHoneyId ? 1 : 0,
        },
      })),
    };
  }, [honey, honeyMode, selectedHoneyId, showHoney]);

  useEffect(() => {
    if (!honeyOpen || !honeyQuery) return;
    const controller = new AbortController();
    let cancelled = false;
    let retryTimer = 0;
    let attempts = 0;
    const run = async () => {
      setHoneyLoading(true);
      setHoneyError(null);
      try {
        const response = await fetch(`/api/honey?${honeyQuery}`, { signal: controller.signal });
        const payload = (await response.json()) as HoneyResponse;
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? "Could not rank money holes");
        setHoney(payload);
        if (payload.partial && attempts < 8) {
          attempts += 1;
          setHoneyLoading(true);
          retryTimer = window.setTimeout(() => void run(), 2800);
        } else {
          setHoneyLoading(false);
        }
      } catch (error) {
        if (cancelled || (error instanceof Error && error.name === "AbortError")) return;
        setHoneyError(error instanceof Error ? error.message : "Could not rank money holes");
        setHoneyLoading(false);
      }
    };
    const start = window.setTimeout(() => void run(), 280);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(start);
      window.clearTimeout(retryTimer);
    };
  }, [honeyOpen, honeyQuery]);

  const folded = Math.max(0, rawCount - reports.length);
  const hazards = filter.hazards ?? ["hail", "wind", "tornado"];
  const showMap = section === "map" || section === "field";
  const hasSignificant = Boolean(threats?.features.some((feature) => feature.properties?.kind === "significant"));
  const radarCaption = historyMode.kind === "day" ? formatDay(historyMode.date) : meshLoading ? "Loading…" : (meshLabel ?? "MESH");

  useEffect(() => {
    const node = chromeRef.current;
    if (!node) return;
    const measure = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      setChromePx((current) => (current === height ? current : height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [showMap, calendarOpen, hailDaysOpen, showMesh, customOpen]);

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
        <div
          className="absolute inset-0"
          style={
            {
              "--chrome-offset": chromePx > 0 ? `${chromePx + 8}px` : calendarOpen ? (hailDaysOpen ? "34rem" : "24rem") : showMesh ? "11.4rem" : "9rem",
            } as CSSProperties
          }
        >
          <HailMap
            theme={theme}
            points={points}
            swaths={historyActive && serverClusters ? { type: "FeatureCollection", features: [] } : swaths}
            mesh={meshCollection}
            dealers={dealerCollection}
            income={income}
            threats={threats}
            showPoints={showPoints}
            showSwaths={showSwaths}
            showMesh={showMesh}
            showIncome={showIncome}
            showThreats={showThreats}
            showOutlook={showOutlook}
            showHeat={showHeat}
            heat={heat}
            showHoney={showHoney}
            honeyPanel={honeyOpen && section === "map"}
            honey={honeyCollection}
            onSelectHoney={(id) => {
              setSelectedHoneyId(id);
              const spot = honey?.spots?.[honeyMode]?.find((item) => item.id === id);
              if (!spot) return;
              holdRankUntil.current = Date.now() + 1600;
              setSelectedId(null);
              setFocus({ lat: spot.lat, lon: spot.lon, zoom: 13, nonce: Date.now() });
            }}
            userLocation={section === "field" ? userLocation : null}
            fieldPins={user ? fieldCollection : null}
            selectedId={selectedId}
            focus={focus}
            frame={frame}
            draftPin={draftPin}
            pickMode={picking}
            blockSelection={reportOpen}
            clusterPoints={!serverClusters}
            onPickLocation={(lon, lat) => setDraftPin({ lat, lon })}
            onSelectReport={(id) => {
              if (id.startsWith("c:")) {
                const parts = id.split(":");
                const lat = Number(parts[1]);
                const lon = Number(parts[2]);
                if (Number.isFinite(lat) && Number.isFinite(lon)) {
                  setFocus({ lat, lon, zoom: 8, nonce: Date.now() });
                }
                return;
              }
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
            onSelectArea={(selection) => {
              setSelectedId(null);
              setThreat(null);
              setCounty(null);
              void loadDealers(selection);
            }}
            onSelectDealer={(id) => {
              setSelectedDealerId(id);
              setSection("field");
              const dealer = dealers.find((item) => item.id === id);
              if (dealer) setFocus({ lon: dealer.lon, lat: dealer.lat, nonce: Date.now(), zoom: 15 });
            }}
            onPreviewBounds={(bounds) => {
              viewBoundsRef.current = bounds;
            }}
            onViewChange={(bounds) => {
              viewBoundsRef.current = bounds;
              setViewBounds(bounds);
              if (Date.now() < holdRankUntil.current) return;
              setRankBounds(bounds);
            }}
          />
          <div ref={chromeRef} className="pointer-events-none absolute inset-x-0 top-0 z-20 space-y-2 px-3 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto flex items-start gap-2">
              <AddressSearch onPick={chooseAddress} />
              <button type="button" onClick={() => setFiltersOpen(true)} className="icon-btn press" aria-label="Filters">
                <SlidersHorizontal size={18} />
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="icon-btn press md:hidden"
                aria-label={theme === "dark" ? "Switch to light map" : "Switch to dark map"}
              >
                {theme === "dark" ? <SunMedium size={18} /> : <Moon size={18} />}
              </button>
              <button
                type="button"
                data-honey-open
                aria-pressed={honeyOpen}
                aria-label="Money holes"
                className="icon-btn press"
                onClick={() => {
                  setCalendarOpen(false);
                  setHailDaysOpen(false);
                  setCustomOpen(false);
                  setHoneyOpen((open) => !open);
                }}
              >
                <Gem size={18} />
              </button>
            </div>
            <div className="pointer-events-auto seg" role="group" aria-label="Hazards and time window">
              {HAZARD_OPTIONS.map((option) => {
                const on = hazards.includes(option.id);
                const Icon = option.id === "wind" ? Wind : option.id === "tornado" ? Tornado : CloudHail;
                return (
                  <button key={option.id} type="button" aria-pressed={on} onClick={() => toggleHazard(option.id)} className="inline-flex items-center gap-1">
                    <Icon size={13} />
                    {option.label}
                  </button>
                );
              })}
              <span className="mx-1 w-px shrink-0 self-stretch bg-line" aria-hidden />
              {TIME_WINDOWS.map((item) => (
                <button
                  key={item.hours}
                  type="button"
                  aria-pressed={!historyActive && filter.hours === item.hours}
                  onClick={() => showLiveWindow(item.hours)}
                >
                  {item.hours === LIVE_WINDOW_HOURS ? "Live" : item.label}
                </button>
              ))}
            </div>
            <div className="pointer-events-auto seg" role="group" aria-label="Storm history">
              {HISTORY_CHIPS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={historyMode.kind === "days" && historyMode.days === item.days}
                  onClick={() => showHistoryDays(item.days)}
                >
                  {item.label}
                </button>
              ))}
              <button type="button" aria-pressed={customOpen || historyMode.kind === "custom"} onClick={() => setCustomOpen((open) => !open)}>
                Custom
              </button>
              <button type="button" aria-pressed={calendarOpen || historyMode.kind === "day"} onClick={showCalendar}>
                Pick a day
              </button>
              <button type="button" aria-pressed={hailDaysOpen} onClick={() => setHailDaysOpen((open) => !open)}>
                Hail days
              </button>
            </div>
            {customOpen ? (
              <form
                className="pointer-events-auto glass flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-xs"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!customStart || !customEnd || customStart > customEnd) return;
                  setHistoryMode({ kind: "custom", start: customStart, end: customEnd });
                  setMeshDate("");
                  setHailDaysOpen(true);
                }}
              >
                <label className="inline-flex items-center gap-1">
                  Start
                  <input type="date" required min="1950-01-01" max={new Date().toISOString().slice(0, 10)} value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="rounded-lg border border-line bg-panel px-1.5 py-1" />
                </label>
                <label className="inline-flex items-center gap-1">
                  End
                  <input type="date" required min="1950-01-01" max={new Date().toISOString().slice(0, 10)} value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="rounded-lg border border-line bg-panel px-1.5 py-1" />
                </label>
                <button type="submit" className="btn btn-primary press px-3 py-1 text-xs">
                  Show range
                </button>
              </form>
            ) : null}
            {calendarOpen ? (
              <div className="pointer-events-auto glass w-[min(22rem,100%)] rounded-2xl p-3">
                <HailCalendar
                  year={calendarYear}
                  month={calendarMonth}
                  selected={historyMode.kind === "day" ? historyMode.date : null}
                  marks={calendarMarks}
                  loading={calendarLoading}
                  caption="Dots show the largest hail in the current map view. Tap a day to load that storm and its radar swath."
                  onViewChange={(year, month) => {
                    setCalendarYear(year);
                    setCalendarMonth(month);
                  }}
                  onSelect={pickStormDay}
                />
              </div>
            ) : historyMode.kind === "day" ? (
              <div className="pointer-events-auto glass flex items-center justify-between gap-2 rounded-2xl px-3 py-1.5 text-xs">
                <span className="font-semibold">{formatDay(historyMode.date)}</span>
                <button type="button" className="font-semibold text-accent" onClick={() => setCalendarOpen(true)}>
                  Calendar
                </button>
              </div>
            ) : null}
            {hailDaysOpen ? (
              <div className="pointer-events-auto glass max-h-60 w-[min(24rem,100%)] overflow-auto rounded-2xl p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Hail days</p>
                  <button type="button" className="text-xs font-semibold text-accent" onClick={() => setHailDaysOpen(false)}>
                    Hide
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted">Sorted by largest hail in the map view. Tap a date to load that day's reports and radar swath.</p>
                {hailDays.length ? (
                  <ul className="mt-2 space-y-1">
                    {hailDays.slice(0, 40).map((day) => (
                      <li key={day.date}>
                        <button type="button" onClick={() => pickStormDay(day.date)} className="press flex w-full items-baseline justify-between gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-white/40">
                          <span className="font-semibold">{formatDay(day.date)}</span>
                          <span className="text-xs text-muted">
                            {day.maxHailIn != null ? `${day.maxHailIn.toFixed(2)} in` : "—"} · {day.hailCount} hail
                            {day.meshMaxIn != null ? ` · radar ${day.meshMaxIn.toFixed(2)}` : ""}
                            {day.windCount ? ` · ${day.windCount} wind` : ""}
                            {day.tornadoCount ? ` · ${day.tornadoCount} tornado` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted">No hail reports in this view and range yet.</p>
                )}
              </div>
            ) : null}
            {showMesh ? (
              <div className="pointer-events-auto glass flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl px-3 py-1.5 text-[11px]" title={meshNote ?? undefined}>
                <span className="shrink-0 font-semibold">Radar</span>
                <span className="shrink-0 font-semibold" data-radar-label>
                  {radarCaption}
                </span>
                {MESH_LEGEND.map((band) => (
                  <span key={band.label} className="inline-flex shrink-0 items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: band.color }} />
                    {band.label}
                  </span>
                ))}
                {meshDate ? (
                  <button type="button" className="shrink-0 font-semibold text-accent" onClick={() => showLiveWindow(filter.hours)}>
                    Use time window
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {stateCounts.length ? (
            <div className={`map-state-jumps pointer-events-none absolute inset-x-0 z-20 px-3 pr-16 ${calendarOpen ? "is-covered" : ""}`}>
              <div className="pointer-events-auto flex gap-1.5 overflow-x-auto" role="toolbar" aria-label="Jump to a state">
                {stateCounts.slice(0, 12).map(([code, count]) => {
                  const on = filter.state === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStateFilter(on ? "" : code)}
                      className={`press shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${on ? "chip-on" : "chip"}`}
                    >
                      {code} {count}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {error ? (
            <p className="map-banner glass absolute inset-x-3 z-20 rounded-xl px-3 py-2 text-sm text-muted">
              {error}
            </p>
          ) : null}
          {(showOutlook || showPoints) && !honeyOpen && !reportOpen && section === "map" && !place && !selected && !threat ? (
            <div className="map-legend pointer-events-none absolute inset-x-3 z-20 flex justify-start">
              <div className="glass pointer-events-auto inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-3 py-2 text-[11px]">
                {showPoints ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="hail-scale" />
                    <span className="font-semibold">Hail</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#1d4ed8" }} />
                      Wind
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#e11d48" }} />
                      Tornado
                    </span>
                  </span>
                ) : null}
                {showOutlook ? (
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
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
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
          {!loading && filtered.length === 0 && !reportOpen ? (
            <p className="glass pointer-events-none absolute left-1/2 top-1/3 z-10 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-sm text-muted">
              {historyLoading
                ? "Loading storm history…"
                : historyActive
                  ? historyNote ?? "No reports in this range for the current map view."
                  : hazards.length === 1 && hazards[0] === "hail"
                    ? emptyWindowMessage(filter.hours)
                    : `No reports in ${windowPhrase(filter.hours).toLowerCase()}.`}
            </p>
          ) : null}
          {section === "map" && honeyOpen ? (
            <HoneyPanel
              label={
                honey?.label ||
                (historyMode.kind === "day"
                  ? formatDay(historyMode.date)
                  : historyMode.kind === "window" && filter.hours <= 24
                    ? windowPhrase(filter.hours)
                    : "Pick a storm day")
              }
              mode={honeyMode}
              onMode={setHoneyMode}
              showHeat={showHoney}
              onToggleHeat={() => setShowHoney((value) => !value)}
              loading={honeyLoading}
              note={honey?.zoom ? honey.note ?? "Zoom in to a metro to rank money holes." : honey?.note ?? null}
              error={honeyError}
              spots={honey?.spots?.[honeyMode] ?? []}
              selectedId={selectedHoneyId}
              needsDay={!honeyQuery}
              attribution={honey?.attribution ?? "Lots © OpenStreetMap contributors. Homes from US Census ACS. Hail from NOAA MRMS MESH."}
              onClose={() => setHoneyOpen(false)}
              onSelect={(spot) => {
                setSelectedHoneyId(spot.id);
                setSelectedId(null);
                setCounty(null);
                setThreat(null);
                holdRankUntil.current = Date.now() + 1600;
                setFocus({ lat: spot.lat, lon: spot.lon, zoom: 13, nonce: Date.now() });
              }}
            />
          ) : null}
          {section === "map" && !honeyOpen && placeCardOpen && placeLabel && placePoint ? (
            <div className="absolute inset-x-3 bottom-3 z-30 max-h-[min(72dvh,36rem)] overflow-y-auto">
              {addressHistory ? (
                <AddressHistoryCard
                  label={placeLabel}
                  history={addressHistory}
                  spanId={addressSpanId}
                  loading={placeLoading}
                  onSpan={(id) => {
                    addressRetries.current = 0;
                    setScoreDate(null);
                    setAddressSpanId(id);
                  }}
                  onSelectDate={(date) => pickStormDay(date)}
                  onClose={() => setPlaceCardOpen(false)}
                  onSave={() => void saveWatch()}
                  onAlert={() => setAlertDraft({ lat: placePoint.lat, lon: placePoint.lon, label: placeLabel })}
                  onReport={() => {
                    setSection("reports");
                    void generateReport("address");
                  }}
                />
              ) : place ? (
                <PropertyCard
                  label={placeLabel}
                  history={place}
                  mesh={status?.mesh}
                  radar={radar}
                  radarLoading={radarLoading}
                  onClose={() => setPlaceCardOpen(false)}
                  onSave={() => void saveWatch()}
                  onAlert={() => setAlertDraft({ lat: placePoint.lat, lon: placePoint.lon, label: placeLabel })}
                  onReport={() => {
                    setSection("reports");
                    void generateReport("address");
                  }}
                />
              ) : (
                <article className="float-card p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Property</p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight">{placeLabel}</h2>
                  <p className="mt-2 text-sm text-muted">{placeError ?? "Checking storm history…"}</p>
                  <button
                    type="button"
                    className="btn btn-primary press mt-3"
                    onClick={() => setAlertDraft({ lat: placePoint.lat, lon: placePoint.lon, label: placeLabel })}
                  >
                    Alert me here
                  </button>
                </article>
              )}
            </div>
          ) : null}
          {section === "map" && !honeyOpen && area && !(placeCardOpen && place) ? (
            <div className="absolute inset-x-3 bottom-3 z-30">
              <article className="float-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                      {area.source === "mesh" ? "Radar hail swath" : area.source === "view" ? "Map area" : "Report swath"}
                    </p>
                    <p className="mt-1 text-lg font-semibold tracking-tight">{area.label}</p>
                    {area.maxIn != null ? <p className="text-sm text-muted">Peak about {area.maxIn.toFixed(2)} in</p> : null}
                  </div>
                  <button type="button" className="btn btn-secondary press px-3 py-1.5 text-xs" onClick={() => setArea(null)}>
                    Close
                  </button>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {dealerLoading
                    ? "Looking up dealerships in this area…"
                    : dealerError
                      ? dealerError
                      : `${dealers.length} dealership${dealers.length === 1 ? "" : "s"} and auto lot${dealers.length === 1 ? "" : "s"}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-primary press"
                    onClick={() => {
                      const center = ringCenter(area.geometry);
                      if (!center) return;
                      setAlertDraft({ lat: center.lat, lon: center.lon, label: area.label });
                    }}
                  >
                    Alert me here
                  </button>
                  <button type="button" className="btn btn-secondary press" onClick={() => setSection("field")}>
                    Open in field mode
                  </button>
                </div>
              </article>
            </div>
          ) : null}
          {section === "map" && !honeyOpen && !(placeCardOpen && place) && !area && (selected || threat || county) ? (
            <div className="absolute inset-x-3 bottom-3 z-30">
              <article className="float-card p-4">
                {selected ? (
                  <>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                      {hazardOf(selected.hazard)} · {selected.photoUrl ? "Community photo" : confidenceLabel(selected.confidence)}
                    </p>
                    <p className="mt-1 text-lg font-semibold tracking-tight">{placeLabelOf(selected)}</p>
                    <p className="text-sm text-muted">
                      <span className="font-semibold text-ink">{magnitudeLabel(selected)}</span> · {formatWhen(selected.occurredAt)}
                    </p>
                    {selected.photoUrl ? (
                      <img src={selected.photoUrl} alt="Community hail photo" className="mt-2 max-h-40 w-full rounded-xl object-cover" />
                    ) : null}
                    {selected.remark ? <p className="mt-2 text-sm">{selected.remark}</p> : null}
                    <button
                      type="button"
                      className="btn btn-primary press mt-3"
                      onClick={() => setAlertDraft({ lat: selected.lat, lon: selected.lon, label: placeLabelOf(selected) })}
                    >
                      Alert me here
                    </button>
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
                areaLabel={area?.label ?? null}
                dealers={dealers}
                dealerLoading={dealerLoading}
                dealerNote={dealerNote}
                dealerError={dealerError}
                selectedDealerId={selectedDealerId}
                onSearchArea={searchVisibleArea}
                onSelectDealer={(id) => {
                  setSelectedDealerId(id);
                  const dealer = dealers.find((item) => item.id === id);
                  if (dealer) setFocus({ lon: dealer.lon, lat: dealer.lat, nonce: Date.now(), zoom: 15 });
                }}
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
              showMesh={showMesh}
              showThreats={showThreats}
              showOutlook={showOutlook}
              showIncome={showIncome}
              showHeat={showHeat}
              showHoney={showHoney}
              onToggle={(key) => {
                if (key === "points") setShowPoints((value) => !value);
                if (key === "swaths") setShowSwaths((value) => !value);
                if (key === "mesh") setShowMesh((value) => !value);
                if (key === "threats") setShowThreats((value) => !value);
                if (key === "outlook") setShowOutlook((value) => !value);
                if (key === "income") setShowIncome((value) => !value);
                if (key === "heat") setShowHeat((value) => !value);
                if (key === "honey") {
                  setShowHoney((value) => {
                    const next = !value;
                    if (next) setHoneyOpen(true);
                    return next;
                  });
                }
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
            <p className="glass pointer-events-none absolute left-3 z-10 rounded-full px-3 py-1 text-xs text-muted" style={{ top: "calc(max(0.5rem, env(safe-area-inset-top)) + var(--chrome-offset) + 2.4rem)" }}>
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
          radar={radar}
          radarLoading={radarLoading}
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
          onAlert={
            placePoint && placeLabel
              ? () => setAlertDraft({ lat: placePoint.lat, lon: placePoint.lon, label: placeLabel })
              : undefined
          }
          onShowMap={() => setSection("map")}
        />
      ) : null}
      {section === "alerts" ? <AlertsPanel onOpenAlert={followAlertLink} /> : null}
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
      {alertDraft ? (
        <AlertHereSheet
          label={alertDraft.label}
          lat={alertDraft.lat}
          lon={alertDraft.lon}
          onClose={() => setAlertDraft(null)}
          onSaved={() => {
            setAlertDraft(null);
            setSection("alerts");
          }}
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

function ringCenter(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { lat: number; lon: number } | null {
  const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!ring?.length) return null;
  let lon = 0;
  let lat = 0;
  for (const pair of ring) {
    lon += pair[0];
    lat += pair[1];
  }
  return { lon: lon / ring.length, lat: lat / ring.length };
}

function placeLabelOf(report: HailReport): string {
  return report.location || report.county || report.state
    ? placeLabel(report)
    : `${report.lat.toFixed(3)}, ${report.lon.toFixed(3)}`;
}
