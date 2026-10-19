import fs from "node:fs";
import path from "node:path";
import type { HistoryRow } from "@/lib/history-db";
import { MESH_ARCHIVE_START, VTEC_POINT_START } from "@/lib/history-coverage";
import { historyDir, meshAtPoint, meshDayReady } from "@/lib/history-db";
import { formatDay, type DateSpan } from "@/lib/history-range";
import { historyRowToReport, queryHistoryNear } from "@/lib/history-query";
import { userAgent } from "@/lib/ingest";
import { gapFor, hostOf, pace } from "@/lib/paced";
import { buildPlaceHistory, type PlaceHistory } from "@/lib/place";
import type { NearbyWarning } from "@/lib/warnings-nearby";
import { warningsFromIem } from "@/lib/warnings-nearby";

export interface AddressEvent {
  date: string;
  label: string;
  spotterMaxIn: number | null;
  hailCount: number;
  windMaxMph: number | null;
  windCount: number;
  tornado: string | null;
  tornadoCount: number;
  meshMaxIn: number | null;
  meshStatus: "ok" | "empty" | "pending" | "outside-archive" | "error" | "no-hail";
  warnings: NearbyWarning[];
  reports: Array<ReturnType<typeof historyRowToReport> & { distanceKm: number }>;
  lossCandidate: boolean;
}

export interface AddressHistory {
  lat: number;
  lon: number;
  radiusKm: number;
  start: string;
  end: string;
  pendingDays: number;
  events: AddressEvent[];
  /** Largest spotter or radar hail in the span, independent of the scored day. */
  maxHailIn: number | null;
  selectedDate: string | null;
  score: PlaceHistory["score"];
  history: PlaceHistory;
  warningNote: string | null;
}

function warningFile(lat: number, lon: number, span: DateSpan): string {
  const key = `${lat.toFixed(2)}_${lon.toFixed(2)}_${span.start}_${span.end}`.replace(/[^a-z0-9._-]/gi, "");
  return path.join(historyDir(), "warnings", `${key}.json`);
}

async function warningsForSpan(lat: number, lon: number, span: DateSpan): Promise<{ warnings: NearbyWarning[]; note: string | null }> {
  if (span.end < VTEC_POINT_START) {
    return { warnings: [], note: "The NWS warning archive used here starts in 1986." };
  }
  const file = warningFile(lat, lon, span);
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { warnings?: NearbyWarning[] };
      return { warnings: parsed.warnings ?? [], note: null };
    } catch {
      fs.rmSync(file, { force: true });
    }
  }
  const start = span.start < VTEC_POINT_START ? VTEC_POINT_START : span.start;
  const url = `https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&sdate=${start}&edate=${span.end}`;
  try {
    const payload = await pace(hostOf(url), gapFor(url), async () => {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent(), Accept: "application/json" },
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<{ events?: Parameters<typeof warningsFromIem>[0] }>;
    });
    const warnings = warningsFromIem(payload.events ?? []).filter((warning) => warning.kind === "warning" || warning.kind === "watch");
    const today = new Date().toISOString().slice(0, 10);
    if (span.end < today) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ warnings }));
      fs.renameSync(temporary, file);
    }
    return {
      warnings,
      note: warnings.length ? null : "No severe thunderstorm or tornado warning was found at this point in the span.",
    };
  } catch (error) {
    console.error("[hailmap] history warnings", error instanceof Error ? error.message : error);
    return { warnings: [], note: "Archived NWS warnings could not be checked." };
  }
}

function convectiveDateOf(iso: string | null): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  if (date.getUTCHours() < 12) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function strongestTornado(rows: HistoryRow[]): string | null {
  let best: string | null = null;
  let rank = -1;
  for (const row of rows) {
    if (row.hazard !== "tornado") continue;
    if (row.efRank > rank) {
      rank = row.efRank;
      best = row.efRating;
    }
  }
  return best;
}

export function isLossCandidate(event: Pick<AddressEvent, "spotterMaxIn" | "meshMaxIn" | "windMaxMph" | "tornadoCount">): boolean {
  return (event.spotterMaxIn ?? 0) >= 1 || (event.meshMaxIn ?? 0) >= 1 || (event.windMaxMph ?? 0) >= 58 || event.tornadoCount > 0;
}

export function groupEvents(
  rows: Array<HistoryRow & { distanceKm: number }>,
  warnings: NearbyWarning[],
  mesh: Map<string, { maxIn: number | null; status: AddressEvent["meshStatus"] }>,
): AddressEvent[] {
  const byDate = new Map<string, Array<HistoryRow & { distanceKm: number }>>();
  for (const row of rows) {
    const list = byDate.get(row.stormDate);
    if (list) list.push(row);
    else byDate.set(row.stormDate, [row]);
  }
  const events: AddressEvent[] = [];
  for (const [date, group] of byDate) {
    let spotterMaxIn: number | null = null;
    let windMaxMph: number | null = null;
    let hailCount = 0;
    let windCount = 0;
    let tornadoCount = 0;
    for (const row of group) {
      if (row.hazard === "hail") {
        hailCount += 1;
        if (row.sizeIn != null) spotterMaxIn = spotterMaxIn == null ? row.sizeIn : Math.max(spotterMaxIn, row.sizeIn);
      } else if (row.hazard === "wind") {
        windCount += 1;
        if (row.windMph != null) windMaxMph = windMaxMph == null ? row.windMph : Math.max(windMaxMph, row.windMph);
      } else if (row.hazard === "tornado") {
        tornadoCount += 1;
      }
    }
    const radar = mesh.get(date);
    const meshStatus: AddressEvent["meshStatus"] =
      hailCount === 0 ? "no-hail" : date < MESH_ARCHIVE_START ? "outside-archive" : (radar?.status ?? "pending");
    const meshMaxIn = radar?.maxIn ?? null;
    const dayWarnings = warnings.filter((warning) => convectiveDateOf(warning.issued) === date);
    const event: AddressEvent = {
      date,
      label: formatDay(date),
      spotterMaxIn,
      hailCount,
      windMaxMph,
      windCount,
      tornado: strongestTornado(group),
      tornadoCount,
      meshMaxIn,
      meshStatus,
      warnings: dayWarnings,
      reports: group.map((row) => ({ ...historyRowToReport(row), distanceKm: row.distanceKm })),
      lossCandidate: false,
    };
    event.lossCandidate = isLossCandidate(event);
    events.push(event);
  }
  events.sort((a, b) => (a.date < b.date ? 1 : -1));
  return events;
}

/** Largest spotter or radar hail anywhere in the span. */
export function rangeMaxHail(events: AddressEvent[]): number | null {
  let max: number | null = null;
  for (const event of events) {
    for (const value of [event.spotterMaxIn, event.meshMaxIn]) {
      if (value == null || !Number.isFinite(value)) continue;
      max = max == null ? value : Math.max(max, value);
    }
  }
  return max;
}

/** The strongest date-of-loss day, which is the largest hail day when one exists. */
export function defaultScoreDate(events: AddressEvent[]): string | null {
  return lossCandidates(events)[0]?.date ?? events[0]?.date ?? null;
}

export function scoreForEvent(input: {
  lat: number;
  lon: number;
  radiusKm: number;
  event: AddressEvent | undefined;
  hours: number;
}): PlaceHistory {
  const reports = input.event?.reports ?? [];
  const newest = reports.reduce((max, report) => Math.max(max, Date.parse(report.occurredAt) || 0), 0);
  const now = newest > 0 ? newest + 3 * 3600 * 1000 : Date.parse(`${input.event?.date ?? "1970-01-01"}T23:00:00Z`);
  return buildPlaceHistory({
    lat: input.lat,
    lon: input.lon,
    radiusKm: input.radiusKm,
    hours: 36,
    now,
    reports,
    warningStatus: "unavailable",
    radarMaxIn: input.event?.meshMaxIn ?? null,
    swath: { hit: false, maxSizeIn: null },
  });
}

export async function buildAddressHistory(input: {
  lat: number;
  lon: number;
  radiusKm: number;
  span: DateSpan;
  scoreDate?: string | null;
  meshDates?: string[];
}): Promise<AddressHistory> {
  const [{ rows, pendingDays }, warningResult] = await Promise.all([
    queryHistoryNear({ span: input.span, lat: input.lat, lon: input.lon, radiusKm: input.radiusKm }),
    warningsForSpan(input.lat, input.lon, input.span),
  ]);
  const hailDates = new Map<string, number>();
  for (const row of rows) {
    if (row.hazard !== "hail" || row.sizeIn == null) continue;
    hailDates.set(row.stormDate, Math.max(hailDates.get(row.stormDate) ?? 0, row.sizeIn));
  }
  const ranked = [...hailDates.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  const wanted = new Set((input.meshDates?.length ? input.meshDates : ranked.slice(0, 14).map(([date]) => date)).filter((date) => date >= MESH_ARCHIVE_START));
  const mesh = new Map<string, { maxIn: number | null; status: AddressEvent["meshStatus"] }>();
  let network = 0;
  for (const date of wanted) {
    const cached = meshDayReady(date);
    if (!cached && network >= 8) {
      mesh.set(date, { maxIn: null, status: "pending" });
      continue;
    }
    if (!cached) network += 1;
    try {
      const { radarSampleFor } = await import("@/lib/mesh-cache");
      const { planMesh } = await import("@/lib/mesh-plan");
      const plan = planMesh({ date });
      if ("error" in plan) {
        mesh.set(date, { maxIn: null, status: "outside-archive" });
        continue;
      }
      const sample = await radarSampleFor(plan, input.lat, input.lon);
      const day = sample.days.find((item) => item.date === date) ?? sample.days[0];
      const failed = !day || day.status === "error";
      if (failed && cached) {
        const maxIn = meshAtPoint(date, input.lat, input.lon);
        mesh.set(date, { maxIn, status: maxIn == null ? "empty" : "ok" });
        continue;
      }
      mesh.set(date, {
        maxIn: day?.maxIn ?? null,
        status: failed ? "error" : day?.maxIn == null ? "empty" : "ok",
      });
    } catch (error) {
      console.error("[hailmap] address mesh", date, error instanceof Error ? error.message : error);
      if (cached) {
        const maxIn = meshAtPoint(date, input.lat, input.lon);
        mesh.set(date, { maxIn, status: maxIn == null ? "empty" : "ok" });
      } else {
        mesh.set(date, { maxIn: null, status: "error" });
      }
    }
  }
  const events = groupEvents(rows, warningResult.warnings, mesh);
  const maxHailIn = rangeMaxHail(events);
  const selectedDate = input.scoreDate && events.some((event) => event.date === input.scoreDate) ? input.scoreDate : defaultScoreDate(events);
  const selected = events.find((event) => event.date === selectedDate);
  const history = scoreForEvent({
    lat: input.lat,
    lon: input.lon,
    radiusKm: input.radiusKm,
    event: selected,
    hours: 36,
  });
  return {
    lat: input.lat,
    lon: input.lon,
    radiusKm: input.radiusKm,
    start: input.span.start,
    end: input.span.end,
    pendingDays,
    events,
    maxHailIn,
    selectedDate,
    score: history.score,
    history,
    warningNote: warningResult.note,
  };
}

export function lossCandidates(events: AddressEvent[]): AddressEvent[] {
  return events
    .filter((event) => event.lossCandidate)
    .sort((a, b) => Math.max(b.meshMaxIn ?? 0, b.spotterMaxIn ?? 0) - Math.max(a.meshMaxIn ?? 0, a.spotterMaxIn ?? 0) || (a.date < b.date ? 1 : -1));
}
