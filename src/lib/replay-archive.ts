import fs from "node:fs";
import path from "node:path";
import type { FeatureCollection } from "geojson";
import { dataDir } from "@/lib/db";
import { userAgent } from "@/lib/ingest";
import { gunzipIfNeeded, readGribMesh } from "@/lib/grib-mesh";
import { cellsToSwaths, type MeshCell, type MeshGridShape } from "@/lib/mesh-contour";
import { MESH_ARCHIVE_START } from "@/lib/history-coverage";
import { gapFor, hostOf, pace } from "@/lib/paced";
import { isoDateUTC, LATEST_MESH_URL } from "@/lib/mesh-plan";
import {
  archiveAtOrBefore,
  clipCells,
  convectiveWindow,
  dayHailCells,
  parseArchiveNames,
  type ReplayBounds,
} from "@/lib/replay-time";

const LATEST_INSTANT_MESH_URL = "https://mrms.ncep.noaa.gov/2D/MESH/MRMS_MESH.latest.grib2.gz";
const CACHE_VERSION = 1;
const LIST_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 15 * 60 * 1000;

interface StoredGrid {
  version: number;
  key: string;
  validTime: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  west: number;
  south: number;
  step: number;
  nx: number;
  ny: number;
  cells: Array<[number, number, number]>;
  missing?: boolean;
  note?: string;
}

export interface ReplayRadarFrame {
  at: string;
  status: "ok" | "empty" | "unavailable" | "error";
  note: string;
  validTime: string | null;
  pulseTime: string | null;
  collection: FeatureCollection;
  pulse: FeatureCollection;
}

const memory = new Map<string, StoredGrid>();
const inflight = new Map<string, Promise<StoredGrid>>();
const lists = new Map<string, { at: number; names: string[] }>();
const listJobs = new Map<string, Promise<string[]>>();

function cacheFile(key: string): string {
  return path.join(dataDir(), "mesh", "replay", `${key.replace(/[^a-z0-9-]/gi, "_")}.json`);
}

function readStored(key: string): StoredGrid | null {
  const hit = memory.get(key);
  if (hit) return hit;
  const file = cacheFile(key);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StoredGrid;
    if (parsed.version !== CACHE_VERSION) return null;
    memory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(stored: StoredGrid) {
  const file = cacheFile(stored.key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(stored));
  fs.renameSync(temporary, file);
  memory.set(stored.key, stored);
}

function fresh(stored: StoredGrid, ttl: number | null): boolean {
  if (ttl == null) return !stored.missing;
  const age = Date.now() - Date.parse(stored.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < ttl;
}

function emptyCollection(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function archiveDir(utcDate: string, product: "MESH" | "MESH_Max_1440min"): string {
  const [year, month, day] = utcDate.split("-");
  return `https://mtarchive.geol.iastate.edu/${year}/${month}/${day}/mrms/ncep/${product}/`;
}

async function listDir(utcDate: string, product: "MESH" | "MESH_Max_1440min"): Promise<string[]> {
  const key = `${product}|${utcDate}`;
  const cached = lists.get(key);
  const closed = Date.parse(`${utcDate}T23:59:59Z`) < Date.now() - 6 * 3600 * 1000;
  if (cached && (closed || Date.now() - cached.at < LIST_TTL_MS)) return cached.names;
  const pending = listJobs.get(key);
  if (pending) return pending;
  const page = archiveDir(utcDate, product);
  const job = (async () => {
    try {
      const html = await pace(hostOf(page), gapFor(page), async () => {
        const response = await fetch(page, {
          headers: { "User-Agent": userAgent(), Accept: "text/html" },
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) return "";
        return response.text();
      });
      const names = parseArchiveNames(html);
      lists.set(key, { at: Date.now(), names });
      return names;
    } catch (error) {
      console.error("[hailmap] replay list", error instanceof Error ? error.message : error);
      return cached?.names ?? [];
    }
  })().finally(() => {
    listJobs.delete(key);
  });
  listJobs.set(key, job);
  return job;
}

async function fetchGrib(url: string): Promise<Buffer | null> {
  return pace(hostOf(url), gapFor(url), async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/octet-stream,*/*" },
      signal: AbortSignal.timeout(45000),
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 64) return null;
    return bytes;
  });
}

function storedFromGrib(key: string, sourceUrl: string, bytes: Buffer): StoredGrid {
  const decoded = readGribMesh(gunzipIfNeeded(bytes));
  return {
    version: CACHE_VERSION,
    key,
    validTime: decoded.validTime,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    west: decoded.shape.west,
    south: decoded.shape.south,
    step: decoded.shape.step,
    nx: decoded.shape.nx,
    ny: decoded.shape.ny,
    cells: decoded.cells.map((cell) => [cell.ix, cell.iy, Math.round(cell.inches * 100) / 100]),
  };
}

function miss(key: string, note: string): StoredGrid {
  return {
    version: CACHE_VERSION,
    key,
    validTime: null,
    sourceUrl: null,
    fetchedAt: new Date().toISOString(),
    west: -130,
    south: 20,
    step: 0.02,
    nx: 0,
    ny: 0,
    cells: [],
    missing: true,
    note,
  };
}

async function loadUrl(key: string, url: string, ttl: number | null): Promise<StoredGrid> {
  const cached = readStored(key);
  if (cached && fresh(cached, cached.missing ? MISS_TTL_MS : ttl)) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    try {
      const bytes = await fetchGrib(url);
      if (!bytes) {
        const failed = miss(key, "Radar file was not found");
        writeStored(failed);
        return failed;
      }
      const stored = storedFromGrib(key, url, bytes);
      writeStored(stored);
      return stored;
    } catch (error) {
      const note = error instanceof Error ? error.message : "Radar file could not be read";
      console.error("[hailmap] replay mesh", url, note);
      if (cached && !cached.missing) return cached;
      const failed = miss(key, note);
      writeStored(failed);
      return failed;
    }
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

function cellsOf(stored: StoredGrid): { shape: MeshGridShape; cells: MeshCell[] } | null {
  if (stored.missing || !stored.nx) return null;
  return {
    shape: { west: stored.west, south: stored.south, step: stored.step || 0.02, nx: stored.nx, ny: stored.ny },
    cells: stored.cells.map(([ix, iy, inches]) => ({ ix, iy, inches })),
  };
}

async function productNames(date: string, product: "MESH" | "MESH_Max_1440min"): Promise<string[]> {
  const window = convectiveWindow(date);
  const days = [date, isoDateUTC(new Date(window.end))];
  const unique = new Set<string>();
  for (const day of days) {
    if (day < MESH_ARCHIVE_START) continue;
    for (const name of await listDir(day, product)) unique.add(`${day}/${name}`);
  }
  return [...unique];
}

function fileUrl(token: string, product: "MESH" | "MESH_Max_1440min"): string {
  const slash = token.indexOf("/");
  const day = token.slice(0, slash);
  const name = token.slice(slash + 1);
  return `${archiveDir(day, product)}${name}`;
}

async function gridAt(
  date: string,
  product: "MESH" | "MESH_Max_1440min",
  targetMs: number,
  maxDeltaMs: number,
): Promise<StoredGrid | null> {
  const names = await productNames(date, product);
  const token = archiveAtOrBefore(names, targetMs, maxDeltaMs);
  if (token) {
    const name = token.slice(token.indexOf("/") + 1);
    const stamp = name.match(/(\d{8})-(\d{6})/);
    const key = `${product === "MESH" ? "scan" : "swath"}-${stamp?.[1] ?? "x"}-${stamp?.[2] ?? token}`;
    return loadUrl(key, fileUrl(token, product), null);
  }
  const age = Date.now() - targetMs;
  if (age >= 0 && age < 50 * 60 * 1000) {
    const url = product === "MESH" ? LATEST_INSTANT_MESH_URL : LATEST_MESH_URL["1440"];
    return loadUrl(product === "MESH" ? "scan-latest" : "swath-latest", url, 8 * 60 * 1000);
  }
  return null;
}

function swathsFrom(cells: MeshCell[], shape: MeshGridShape, label: string, validTime: string | null): FeatureCollection {
  if (!cells.length) return emptyCollection();
  return cellsToSwaths(cells, shape, { product: "MESH", validTime, label });
}

export async function replayRadarFrame(input: {
  date: string;
  at: string;
  bounds: ReplayBounds;
}): Promise<ReplayRadarFrame> {
  const atMs = Date.parse(input.at);
  const empty = (status: ReplayRadarFrame["status"], note: string): ReplayRadarFrame => ({
    at: input.at,
    status,
    note,
    validTime: null,
    pulseTime: null,
    collection: emptyCollection(),
    pulse: emptyCollection(),
  });
  if (!Number.isFinite(atMs)) return empty("error", "That replay time is not valid.");
  if (input.date < MESH_ARCHIVE_START) {
    return empty("unavailable", "Radar hail swaths in the Iowa State archive start on 2019-09-28. Reports still replay.");
  }
  const window = convectiveWindow(input.date);
  const baselineMs = Date.parse(window.start);
  const [baseline, current, pulseGrid] = await Promise.all([
    gridAt(input.date, "MESH_Max_1440min", baselineMs, 3 * 3600 * 1000),
    gridAt(input.date, "MESH_Max_1440min", atMs, 40 * 60 * 1000),
    gridAt(input.date, "MESH", atMs, 12 * 60 * 1000),
  ]);
  const currentGrid = current ? cellsOf(current) : null;
  const baseGrid = baseline ? cellsOf(baseline) : null;
  if (!currentGrid) {
    return empty("error", "That radar scan is not in the archive yet.");
  }
  const grown = baseGrid ? dayHailCells(baseGrid.cells, currentGrid.cells) : currentGrid.cells;
  const clipped = clipCells(grown, currentGrid.shape, input.bounds);
  const collection = swathsFrom(clipped, currentGrid.shape, "Replay", current?.validTime ?? null);
  let pulse = emptyCollection();
  let pulseTime: string | null = null;
  const pulseCells = pulseGrid ? cellsOf(pulseGrid) : null;
  if (pulseCells) {
    const visible = clipCells(
      pulseCells.cells.filter((cell) => cell.inches >= 0.75),
      pulseCells.shape,
      input.bounds,
    );
    pulse = swathsFrom(visible, pulseCells.shape, "Scan", pulseGrid?.validTime ?? null);
    pulseTime = pulseGrid?.validTime ?? null;
  }
  const status = collection.features.length || pulse.features.length ? "ok" : "empty";
  const note =
    status === "empty"
      ? "No new radar hail at or above 0.75 in has built up in this view by this time."
      : "Radar swath is the MRMS 24-hour maximum building since 12:00 UTC. The brighter scan is hail in the latest few minutes.";
  return {
    at: input.at,
    status,
    note,
    validTime: current?.validTime ?? null,
    pulseTime,
    collection,
    pulse,
  };
}

const openingWarmed = new Set<string>();

/** Download the convective-day baseline so the first frame spends less time waiting. */
export function warmReplayBaseline(date: string) {
  if (date < MESH_ARCHIVE_START) return;
  const start = Date.parse(convectiveWindow(date).start);
  void gridAt(date, "MESH_Max_1440min", start, 3 * 3600 * 1000).catch((error) => {
    console.error("[hailmap] replay warm", error instanceof Error ? error.message : error);
  });
}

/**
 * Pull the opening scans into the grid cache before the player asks.
 * The files are shared across bounds, so a phone that refits the metro
 * still hits this cache instead of starting the archive download over.
 */
export function warmReplayOpening(date: string, frames: string[]) {
  if (date < MESH_ARCHIVE_START) return;
  for (const at of frames.slice(0, 4)) {
    const atMs = Date.parse(at);
    const key = `${date}|${at}`;
    if (!Number.isFinite(atMs) || openingWarmed.has(key)) continue;
    openingWarmed.add(key);
    void gridAt(date, "MESH_Max_1440min", atMs, 40 * 60 * 1000).catch((error) => {
      console.error("[hailmap] replay warm", error instanceof Error ? error.message : error);
    });
    void gridAt(date, "MESH", atMs, 12 * 60 * 1000).catch((error) => {
      console.error("[hailmap] replay warm", error instanceof Error ? error.message : error);
    });
  }
}
