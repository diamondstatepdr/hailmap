import fs from "node:fs";
import path from "node:path";
import { dataDir, listRecentReports } from "@/lib/db";
import { gridTiles, type HoneyBounds } from "@/lib/honey";
import { loadRoofTracts } from "@/lib/honey-census";
import { fillOsmTiles } from "@/lib/honey-osm";
import { historyDb } from "@/lib/history-db";
import { addIsoDays, isoDateUTC } from "@/lib/mesh-plan";

const CELL = 0.5;
const PAD = 0.08;
const RECENT_DAYS = 10;
/** Fresh Overpass tiles per pass. The shared pacer already waits 1.5s between calls. */
const TILES_PER_PASS = 6;

export interface HailPoint {
  lat: number;
  lon: number;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * Metro boxes around hail reports. Each box is one half-degree cell plus a small
 * pad, so a warm pass stays on city-sized Overpass queries.
 */
export function hailAreas(points: HailPoint[]): HoneyBounds[] {
  const cells = new Map<string, HoneyBounds>();
  for (const point of points) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue;
    if (Math.abs(point.lat) > 85 || Math.abs(point.lon) > 180) continue;
    const south = Math.floor(point.lat / CELL) * CELL;
    const west = Math.floor(point.lon / CELL) * CELL;
    const key = `${west.toFixed(2)},${south.toFixed(2)}`;
    if (cells.has(key)) continue;
    cells.set(key, {
      west: round(west - PAD),
      south: round(south - PAD),
      east: round(west + CELL + PAD),
      north: round(south + CELL + PAD),
    });
  }
  return [...cells.values()];
}

/** How many Overpass tiles a warm plan still has to fetch, ignoring the network. */
export function warmTileCount(areas: HoneyBounds[]): number {
  return areas.reduce((sum, area) => sum + gridTiles(area, 0.36).length, 0);
}

function recentHailPoints(now = new Date()): HailPoint[] {
  const since = addIsoDays(isoDateUTC(now), -(RECENT_DAYS - 1));
  const points: HailPoint[] = [];
  for (const report of listRecentReports(RECENT_DAYS)) {
    if (report.hazard !== "hail" || (report.sizeIn ?? 0) < 0.75) continue;
    points.push({ lat: report.lat, lon: report.lon });
  }
  const file = path.join(dataDir(), "history", "history.sqlite");
  if (!fs.existsSync(file)) return points;
  try {
    const rows = historyDb()
      .prepare(
        `SELECT lat, lon FROM history_reports
         WHERE hazard = 'hail' AND size_in >= 0.75 AND storm_date >= ?
         LIMIT 5000`,
      )
      .all(since) as Array<{ lat: number; lon: number }>;
    for (const row of rows) points.push(row);
  } catch (error) {
    console.error("[hailmap] honey warm history", error instanceof Error ? error.message : error);
  }
  return points;
}

let cursor = 0;

async function warmOnce(): Promise<void> {
  const areas = hailAreas(recentHailPoints());
  if (!areas.length) return;
  const start = cursor % areas.length;
  cursor = (start + 1) % areas.length;
  let budget = TILES_PER_PASS;
  for (let offset = 0; offset < areas.length && budget > 0; offset += 1) {
    const area = areas[(start + offset) % areas.length];
    const fetched = await fillOsmTiles(area, () => 1, budget);
    budget -= fetched;
    if (budget > 0) {
      try {
        await loadRoofTracts(area);
      } catch (error) {
        console.error("[hailmap] honey warm census", error instanceof Error ? error.message : error);
      }
    }
  }
}

let started = false;
let running = false;
let again = false;
let timer: NodeJS.Timeout | null = null;

function warmingDisabled(): boolean {
  return process.env.HAILMAP_HONEY_WARM === "0";
}

/** Queue one paced pass. Safe to call on startup and whenever a new hail day lands. */
export function scheduleHoneyWarm(): void {
  if (warmingDisabled()) return;
  if (running) {
    again = true;
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void runWarm();
  }, 4000);
  timer.unref?.();
}

async function runWarm(): Promise<void> {
  running = true;
  try {
    await warmOnce();
  } catch (error) {
    console.error("[hailmap] honey warm", error instanceof Error ? error.message : error);
  } finally {
    running = false;
    if (again && !warmingDisabled()) {
      again = false;
      scheduleHoneyWarm();
    }
  }
}

/** Background warm of OSM lots and Census homes around recent hail. Cached under the data directory. */
export function startHoneyWarm(): void {
  if (warmingDisabled() || started) return;
  started = true;
  scheduleHoneyWarm();
  const interval = setInterval(() => scheduleHoneyWarm(), 3 * 60 * 1000);
  interval.unref?.();
  console.log("[hailmap] money hole warm started");
}
