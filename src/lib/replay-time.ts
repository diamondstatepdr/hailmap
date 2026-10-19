import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { MeshCell, MeshGridShape } from "@/lib/mesh-contour";
import { addIsoDays, isIsoDate } from "@/lib/mesh-plan";

export interface ReplayBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Convective day used by the radar archive: 12:00 UTC through 12:00 UTC the next day. */
export function convectiveWindow(date: string, now = new Date()): { start: string; end: string } {
  const startMs = Date.parse(`${date}T12:00:00.000Z`);
  const cap = Date.parse(`${addIsoDays(date, 1)}T12:00:00.000Z`);
  const endMs = Math.min(cap, now.getTime());
  const end = endMs < startMs ? startMs : endMs;
  return { start: new Date(startMs).toISOString(), end: new Date(end).toISOString() };
}

/**
 * Clock-aligned frames inside a window. 15-minute steps land on :00, :15, :30, and :45 UTC
 * because the epoch is on a 15-minute boundary.
 */
export function replayFrames(startIso: string, endIso: string, stepMinutes = 15): string[] {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const step = Math.max(1, stepMinutes) * 60 * 1000;
  const last = Math.max(start, end);
  const first = Math.ceil(start / step) * step;
  if (first > last + 500) return [new Date(last).toISOString()];
  const frames: string[] = [];
  for (let time = first; time <= last + 500 && frames.length < 192; time += step) {
    frames.push(new Date(time).toISOString());
  }
  return frames.length ? frames : [new Date(last).toISOString()];
}

/** Playhead plus the next few steps, so the swath is already cached when the clock moves. */
export function prefetchFrameTimes(frames: string[], index: number, stepMinutes: 15 | 60, ahead = 3): string[] {
  if (!frames.length) return [];
  const start = Math.max(0, Math.min(index, frames.length - 1));
  const stride = stepMinutes === 60 ? 4 : 1;
  const times: string[] = [];
  for (let offset = 0; offset <= ahead; offset += 1) {
    const frameIndex = start + offset * stride;
    if (frameIndex >= frames.length) break;
    times.push(frames[frameIndex]);
  }
  return times;
}

/** Latest frame at or before the playhead whose radar is already stored. -1 when none are. */
export function loadedFrameIndex(frames: string[], index: number, loaded: (at: string) => boolean): number {
  if (!frames.length) return -1;
  const start = Math.max(0, Math.min(index, frames.length - 1));
  for (let cursor = start; cursor >= 0; cursor -= 1) {
    if (loaded(frames[cursor])) return cursor;
  }
  return -1;
}

/** Shrink a window to the events inside it, with padding, and keep it inside the convective day. */
export function activeWindow(
  eventTimes: number[],
  window: { start: string; end: string },
  padBeforeMs = 60 * 60 * 1000,
  padAfterMs = 45 * 60 * 1000,
): { start: string; end: string } {
  const open = Date.parse(window.start);
  const close = Date.parse(window.end);
  const finite = eventTimes.filter((time) => Number.isFinite(time) && time >= open - padBeforeMs && time <= close + padAfterMs);
  if (!finite.length || !Number.isFinite(open) || !Number.isFinite(close)) return window;
  const start = Math.max(open, Math.min(...finite) - padBeforeMs);
  const end = Math.min(close, Math.max(...finite) + padAfterMs);
  if (end < start) return { start: new Date(start).toISOString(), end: new Date(start).toISOString() };
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

export function stormTimeZone(lon: number): string {
  if (lon < -140) return "America/Anchorage";
  if (lon < -114) return "America/Los_Angeles";
  if (lon < -102) return "America/Denver";
  if (lon < -90) return "America/Chicago";
  if (lon < -60) return "America/New_York";
  return "UTC";
}

export function formatReplayClock(iso: string, timeZone: string): string {
  const parts = formatReplayClockParts(iso, timeZone);
  if (!parts) return iso;
  return `${parts.time} ${parts.period} ${parts.zone}`.replace(/\s+/g, " ").trim();
}

export interface ReplayClockParts {
  time: string;
  period: string;
  zone: string;
  date: string;
}

/** Split local storm time so the player can set the clock apart from the date and zone. */
export function formatReplayClockParts(iso: string, timeZone: string): ReplayClockParts | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
    timeZone,
  }).formatToParts(date);
  const zone = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", hour: "numeric", timeZone })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
  const hour = clock.find((part) => part.type === "hour")?.value ?? "";
  const minute = clock.find((part) => part.type === "minute")?.value ?? "00";
  const period = clock.find((part) => part.type === "dayPeriod")?.value ?? "";
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone }).format(date);
  return { time: `${hour}:${minute}`, period, zone, date: day };
}

/**
 * Positions, 0–100, for hail reports along a replay scrubber.
 * Marks closer than about 1% of the timeline collapse into one tick.
 */
export function hailReportTicks(frames: string[], reports: Array<{ occurredAt: string; hazard?: string }>): number[] {
  if (frames.length < 2) return [];
  const start = Date.parse(frames[0]);
  const end = Date.parse(frames[frames.length - 1]);
  const span = end - start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || span <= 0) return [];
  const marks: number[] = [];
  const kept: number[] = [];
  for (const report of reports) {
    if (report.hazard && report.hazard !== "hail") continue;
    const time = Date.parse(report.occurredAt);
    if (!Number.isFinite(time) || time < start || time > end) continue;
    if (kept.some((stamp) => Math.abs(stamp - time) < 12 * 60 * 1000)) continue;
    kept.push(time);
    marks.push(Math.round(((time - start) / span) * 1000) / 10);
  }
  return marks;
}

/**
 * Hail that is new since the convective-day baseline.
 * MESH_Max_1440min is a rolling 24-hour maximum, so yesterday's stones are still in the grid
 * until they age out. A cell counts for this storm day when its maximum rose.
 */
export function dayHailCells(baseline: MeshCell[], current: MeshCell[], epsilon = 0.05): MeshCell[] {
  const base = new Map<number, number>();
  for (const cell of baseline) {
    const key = cell.ix + cell.iy * 100000;
    const prev = base.get(key);
    if (prev == null || cell.inches > prev) base.set(key, cell.inches);
  }
  const next: MeshCell[] = [];
  for (const cell of current) {
    const prev = base.get(cell.ix + cell.iy * 100000) ?? 0;
    if (cell.inches > prev + epsilon) next.push(cell);
  }
  return next;
}

export function clipCells(cells: MeshCell[], shape: MeshGridShape, bounds: ReplayBounds): MeshCell[] {
  const ix0 = Math.floor((bounds.west - shape.west) / shape.step) - 1;
  const ix1 = Math.ceil((bounds.east - shape.west) / shape.step) + 1;
  const iy0 = Math.floor((bounds.south - shape.south) / shape.step) - 1;
  const iy1 = Math.ceil((bounds.north - shape.south) / shape.step) + 1;
  return cells.filter((cell) => cell.ix >= ix0 && cell.ix <= ix1 && cell.iy >= iy0 && cell.iy <= iy1);
}

export function parseArchiveNames(html: string): string[] {
  const names = new Set<string>();
  for (const match of html.matchAll(/href="([^"]+\.grib2\.gz)"/gi)) {
    const name = decodeURIComponent(match[1].split("/").pop() ?? "");
    if (name.endsWith(".grib2.gz")) names.add(name);
  }
  return [...names];
}

export function archiveStamp(name: string): number | null {
  const match = name.match(/(\d{8})-(\d{6})/);
  if (!match) return null;
  const day = match[1];
  const clock = match[2];
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4, 6)}Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

/** Latest archive file at or just before the playhead. */
export function archiveAtOrBefore(names: string[], targetMs: number, maxDeltaMs: number): string | null {
  let best: { name: string; delta: number } | null = null;
  for (const name of names) {
    const stamp = archiveStamp(name);
    if (stamp == null) continue;
    const delta = targetMs - stamp;
    if (delta < -90_000 || delta > maxDeltaMs) continue;
    if (!best || delta < best.delta) best = { name, delta };
  }
  return best?.name ?? null;
}

export function warningActive(begin: string | null, end: string | null, atMs: number): boolean {
  const start = begin ? Date.parse(begin) : NaN;
  const stop = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(start)) return false;
  if (!Number.isFinite(stop)) return start <= atMs;
  return start <= atMs && atMs < stop;
}

function stretch(box: ReplayBounds, position: Position) {
  box.west = Math.min(box.west, position[0]);
  box.east = Math.max(box.east, position[0]);
  box.south = Math.min(box.south, position[1]);
  box.north = Math.max(box.north, position[1]);
}

function walkBox(coords: unknown, box: ReplayBounds) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    stretch(box, coords as Position);
    return;
  }
  for (const part of coords) walkBox(part, box);
}

export function geometryHitsBounds(geometry: Geometry | null | undefined, bounds: ReplayBounds): boolean {
  if (!geometry) return false;
  if (geometry.type === "GeometryCollection") return geometry.geometries.some((item) => geometryHitsBounds(item, bounds));
  const box: ReplayBounds = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  walkBox(geometry.coordinates, box);
  if (!Number.isFinite(box.west)) return false;
  return box.east >= bounds.west && box.west <= bounds.east && box.north >= bounds.south && box.south <= bounds.north;
}

export function featuresAtTime<T extends Feature>(features: T[], atMs: number): T[] {
  return features.filter((feature) => {
    const props = feature.properties as { begin?: string; end?: string } | null;
    return warningActive(props?.begin ?? null, props?.end ?? null, atMs);
  });
}

export function collectionAtTime(collection: FeatureCollection, atMs: number): FeatureCollection {
  return { type: "FeatureCollection", features: featuresAtTime(collection.features, atMs) };
}

const KM_PER_LAT = 111.32;
/** Searched-city replay window: metro scale, about 60–100 km across. */
const REPLAY_METRO_KM = 96;

function kmPerLon(lat: number): number {
  return KM_PER_LAT * Math.cos((lat * Math.PI) / 180);
}

function boxAround(center: { lat: number; lon: number }, latKm: number, lonKm = latKm): ReplayBounds {
  const dLat = latKm / KM_PER_LAT / 2;
  const dLon = lonKm / Math.max(kmPerLon(center.lat), 1) / 2;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    west: round(center.lon - dLon),
    south: round(center.lat - dLat),
    east: round(center.lon + dLon),
    north: round(center.lat + dLat),
  };
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const latKm = (a.lat - b.lat) * KM_PER_LAT;
  const lonKm = (a.lon - b.lon) * kmPerLon((a.lat + b.lat) / 2);
  return Math.hypot(latKm, lonKm);
}

/**
 * Bounds for a replay. An address, a neighborhood, and a national view all land on a metro
 * window around the searched point so the storm core is on screen instead of a multi-state map.
 * A view that is already about 70–100 km across is left alone.
 * When storm reports are passed, the window shifts toward them but keeps the searched point on screen.
 */
export function frameReplayBounds(
  view: ReplayBounds | null,
  center?: { lat: number; lon: number } | null,
  points?: Array<{ lat: number; lon: number }>,
): ReplayBounds {
  const lat = center?.lat ?? (view ? (view.north + view.south) / 2 : 39);
  const lon = center?.lon ?? (view ? (view.east + view.west) / 2 : -97);
  if (center || !view) return boxAround(biasTowardReports(lat, lon, points), REPLAY_METRO_KM);
  const latKm = (view.north - view.south) * KM_PER_LAT;
  const lonKm = (view.east - view.west) * kmPerLon(lat);
  if (latKm < 70 || lonKm < 70 || latKm > 100 || lonKm > 100) return boxAround({ lat, lon }, REPLAY_METRO_KM);
  return boxAround({ lat, lon }, latKm, lonKm);
}

function biasTowardReports(lat: number, lon: number, points?: Array<{ lat: number; lon: number }>): { lat: number; lon: number } {
  const anchor = { lat, lon };
  const nearby = (points ?? []).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon) && distanceKm(anchor, point) <= 75);
  if (!nearby.length) return anchor;
  const meanLat = nearby.reduce((sum, point) => sum + point.lat, 0) / nearby.length;
  const meanLon = nearby.reduce((sum, point) => sum + point.lon, 0) / nearby.length;
  let midLat = (lat + meanLat) / 2;
  let midLon = (lon + meanLon) / 2;
  const halfLat = REPLAY_METRO_KM / KM_PER_LAT / 2;
  const halfLon = REPLAY_METRO_KM / Math.max(kmPerLon(midLat), 1) / 2;
  const keepLat = halfLat * 0.72;
  const keepLon = halfLon * 0.72;
  midLat = Math.min(lat + keepLat, Math.max(lat - keepLat, midLat));
  midLon = Math.min(lon + keepLon, Math.max(lon - keepLon, midLon));
  return { lat: midLat, lon: midLon };
}

export function parseReplayQuery(params: URLSearchParams): { date: string; bounds: ReplayBounds } | { error: string } {
  const date = params.get("date")?.trim() ?? "";
  if (!isIsoDate(date)) return { error: "date must be YYYY-MM-DD" };
  const west = Number(params.get("west"));
  const south = Number(params.get("south"));
  const east = Number(params.get("east"));
  const north = Number(params.get("north"));
  if (![west, south, east, north].every(Number.isFinite)) return { error: "west, south, east, and north are required" };
  if (south >= north || west >= east || south < -85 || north > 85) return { error: "Those map bounds are not usable." };
  if (north - south > 20 || east - west > 25) return { error: "Zoom in before replaying. Radar frames stay inside a regional view." };
  return { date, bounds: { west, south, east, north } };
}
