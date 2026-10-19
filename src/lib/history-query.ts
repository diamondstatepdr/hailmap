import { convectiveDay } from "@/lib/parsers";
import { haversineKm } from "@/lib/geo";
import type { HailReport } from "@/lib/types";
import { clusterCellDegrees, clusterReports, shouldCluster, type ReportCluster } from "@/lib/history-cluster";
import {
  countHistory,
  hailDaysInBounds,
  meshMaxInBounds,
  selectHistory,
  selectHistoryNear,
  type HailDayRow,
  type HistoryBounds,
  type HistoryRow,
} from "@/lib/history-db";
import { daysInSpan, type DateSpan } from "@/lib/history-range";
import { efRank } from "@/lib/hazard";
import { getMapReports } from "@/lib/ingest";
import { addIsoDays, isoDateUTC } from "@/lib/mesh-plan";
import { ensureDailySpan, ensureHistoryIndex } from "@/lib/spc-archive";

const POINT_CAP = 60000;

export interface HistoryMapResult {
  mode: "points" | "clusters";
  start: string;
  end: string;
  total: number;
  pendingDays: number;
  reports: HailReport[];
  clusters: ReportCluster[];
}

export function historyRowToReport(row: HistoryRow, distanceKm?: number): HailReport & { distanceKm?: number } {
  return {
    id: row.id,
    source: row.source === "spc-svrgis" || row.source === "spc-daily" ? "spc" : row.source,
    confidence: row.confidence,
    hazard: row.hazard,
    lat: row.lat,
    lon: row.lon,
    sizeIn: row.sizeIn,
    sizeRaw: null,
    windMph: row.windMph,
    efRating: row.efRating,
    occurredAt: row.occurredAt,
    location: row.location,
    county: row.county,
    state: row.state,
    remark: row.source === "spc-svrgis" ? "SPC severe weather database" : null,
    damageTags: [],
    ...(distanceKm != null ? { distanceKm } : {}),
  };
}

function liveStormDate(iso: string): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return convectiveDay(new Date(time));
}

function inBounds(lat: number, lon: number, bounds: HistoryBounds): boolean {
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

async function liveRows(span: DateSpan, bounds: HistoryBounds, state: string): Promise<HistoryRow[]> {
  const today = isoDateUTC(new Date());
  if (span.end < addIsoDays(today, -8)) return [];
  const map = await getMapReports();
  const rows: HistoryRow[] = [];
  for (const report of map.reports) {
    const stormDate = liveStormDate(report.occurredAt);
    if (!stormDate || stormDate < span.start || stormDate > span.end) continue;
    if (!inBounds(report.lat, report.lon, bounds)) continue;
    if (report.source === "seed") continue;
    if (state && (report.state ?? "").toUpperCase() !== state) continue;
    const confidence = report.confidence === "spotter" || report.confidence === "community" || report.confidence === "mesh" ? report.confidence : "nws";
    rows.push({
      id: report.id,
      source: report.source,
      confidence,
      hazard: report.hazard === "wind" || report.hazard === "tornado" ? report.hazard : "hail",
      lat: report.lat,
      lon: report.lon,
      sizeIn: report.sizeIn,
      windMph: report.windMph,
      efRating: report.efRating,
      efRank: efRank(report.efRating),
      occurredAt: report.occurredAt,
      stormDate,
      state: report.state,
      location: report.location,
      county: report.county,
    });
  }
  return rows;
}

function dedupe(rows: HistoryRow[]): HistoryRow[] {
  const seen = new Set<string>();
  const kept: HistoryRow[] = [];
  const sorted = [...rows].sort((a, b) => (a.source === "spc-svrgis" ? 1 : 0) - (b.source === "spc-svrgis" ? 1 : 0));
  for (const row of sorted) {
    const key = `${row.hazard}|${row.stormDate}|${row.lat.toFixed(2)}|${row.lon.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

export async function queryHistoryMap(input: {
  span: DateSpan;
  bounds: HistoryBounds;
  state?: string;
}): Promise<HistoryMapResult> {
  await ensureHistoryIndex();
  const pending = await ensureDailySpan(input.span.start, input.span.end, 12);
  const state = (input.state ?? "").trim().toUpperCase();
  const total = countHistory(input.span, input.bounds, state);
  const spanDeg = Math.max(input.bounds.east - input.bounds.west, input.bounds.north - input.bounds.south);
  const live = await liveRows(input.span, input.bounds, state);
  const archive = selectHistory(input.span, input.bounds, state, POINT_CAP);
  const rows = dedupe([...live, ...archive]);
  const cluster = shouldCluster(rows.length, spanDeg) || total > POINT_CAP;
  if (!cluster) {
    return {
      mode: "points",
      start: input.span.start,
      end: input.span.end,
      total: Math.max(total, rows.length),
      pendingDays: pending.pending,
      reports: rows.map((row) => historyRowToReport(row)),
      clusters: [],
    };
  }
  const clusters = clusterReports(rows, clusterCellDegrees(spanDeg));
  return {
    mode: "clusters",
    start: input.span.start,
    end: input.span.end,
    total: Math.max(total, rows.length),
    pendingDays: pending.pending,
    reports: [],
    clusters,
  };
}

export interface HailDaySummary extends HailDayRow {
  meshMaxIn: number | null;
  strongestTornado: string | null;
}

function tornadoLabel(rank: number, date: string): string | null {
  if (rank < 0) return null;
  return `${Number(date.slice(0, 4)) >= 2007 ? "EF" : "F"}${rank}`;
}

export async function queryHailDays(input: {
  span: DateSpan;
  bounds: HistoryBounds;
  state?: string;
}): Promise<{ days: HailDaySummary[]; pendingDays: number; start: string; end: string }> {
  await ensureHistoryIndex();
  const pending = await ensureDailySpan(input.span.start, input.span.end, 8);
  const state = (input.state ?? "").trim().toUpperCase();
  const mesh = meshMaxInBounds(input.span, input.bounds);
  const days = hailDaysInBounds(input.span, input.bounds, state)
    .map((day) => ({
      ...day,
      meshMaxIn: mesh.get(day.date) ?? null,
      strongestTornado: tornadoLabel(day.maxEfRank, day.date),
    }))
    .sort((a, b) => {
      const hail = (b.maxHailIn ?? -1) - (a.maxHailIn ?? -1);
      if (hail) return hail;
      const mesh = (b.meshMaxIn ?? -1) - (a.meshMaxIn ?? -1);
      if (mesh) return mesh;
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  return { days, pendingDays: pending.pending, start: input.span.start, end: input.span.end };
}

export async function queryHistoryNear(input: {
  span: DateSpan;
  lat: number;
  lon: number;
  radiusKm: number;
}): Promise<{ rows: Array<HistoryRow & { distanceKm: number }>; pendingDays: number }> {
  await ensureHistoryIndex();
  const pending = await ensureDailySpan(input.span.start, input.span.end, 20);
  const dLat = input.radiusKm / 110.574;
  const dLon = input.radiusKm / (111.32 * Math.max(0.2, Math.cos((input.lat * Math.PI) / 180)));
  const bounds = {
    west: input.lon - dLon,
    east: input.lon + dLon,
    south: input.lat - dLat,
    north: input.lat + dLat,
  };
  const archive = selectHistoryNear(input.span, bounds);
  const live = await liveRows(input.span, bounds, "");
  const rows = dedupe([...live, ...archive])
    .map((row) => ({ ...row, distanceKm: haversineKm(input.lat, input.lon, row.lat, row.lon) }))
    .filter((row) => row.distanceKm <= input.radiusKm)
    .sort((a, b) => a.stormDate < b.stormDate ? 1 : a.stormDate > b.stormDate ? -1 : a.distanceKm - b.distanceKm);
  return { rows, pendingDays: pending.pending };
}

export function spanIsHeavy(span: DateSpan): boolean {
  return daysInSpan(span) > 10;
}

export function parseHistoryBounds(params: URLSearchParams): HistoryBounds | { error: string } {
  const west = Number(params.get("west"));
  const south = Number(params.get("south"));
  const east = Number(params.get("east"));
  const north = Number(params.get("north"));
  if (![west, south, east, north].every(Number.isFinite)) return { error: "west, south, east, and north are required" };
  if (west >= east || south >= north) return { error: "Those map bounds are empty." };
  if (north > 90 || south < -90 || west < -180 || east > 180) return { error: "Those map bounds are outside the world." };
  return { west, south, east, north };
}
