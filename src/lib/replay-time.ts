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
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
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

/**
 * Bounds for a replay. A neighborhood view is widened so the swath can move across the metro.
 * A national view is tightened around its center, or around an address.
 */
export function frameReplayBounds(view: ReplayBounds | null, center?: { lat: number; lon: number } | null): ReplayBounds {
  const lat = center?.lat ?? (view ? (view.north + view.south) / 2 : 39);
  const lon = center?.lon ?? (view ? (view.east + view.west) / 2 : -97);
  let south = view?.south ?? lat - 1.3;
  let north = view?.north ?? lat + 1.3;
  let west = view?.west ?? lon - 1.6;
  let east = view?.east ?? lon + 1.6;
  const minLat = center ? 2.6 : 2.2;
  const minLon = center ? 3.2 : 2.8;
  if (north - south < minLat) {
    south = lat - minLat / 2;
    north = lat + minLat / 2;
  }
  if (east - west < minLon) {
    west = lon - minLon / 2;
    east = lon + minLon / 2;
  }
  const maxLat = 6.5;
  const maxLon = 8;
  if (north - south > maxLat) {
    south = lat - maxLat / 2;
    north = lat + maxLat / 2;
  }
  if (east - west > maxLon) {
    west = lon - maxLon / 2;
    east = lon + maxLon / 2;
  }
  return {
    west: Math.round(west * 1000) / 1000,
    south: Math.round(south * 1000) / 1000,
    east: Math.round(east * 1000) / 1000,
    north: Math.round(north * 1000) / 1000,
  };
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
