import fs from "node:fs";
import path from "node:path";
import type { FeatureCollection } from "geojson";
import { dataDir } from "@/lib/db";
import { userAgent } from "@/lib/ingest";
import type { RadarSample } from "@/lib/area-selection";
import { gunzipIfNeeded, readGribMesh } from "@/lib/grib-mesh";
import {
  cellsToSwaths,
  indexCells,
  sampleCell,
  sampleIndexed,
  swathBounds,
  type MeshCell,
  type MeshGridShape,
} from "@/lib/mesh-contour";
import { MESH_LEGEND } from "@/lib/mesh-legend";
import { MESH_ARCHIVE_START, MESH_INSTANT_START } from "@/lib/history-coverage";
import { meshBudgetBytes, meshStoreDecision } from "@/lib/mesh-budget";
import { meshDayReady, recordMeshGrid } from "@/lib/history-db";
import { gapFor, hostOf, pace } from "@/lib/paced";
import {
  LATEST_MESH_URL,
  addIsoDays,
  dayFetchUrls,
  formatStormDate,
  isoDateUTC,
  meshArchivePage,
  meshDirectory,
  pickHourlyMeshNames,
  pickMeshArchiveName,
  type MeshRequestPlan,
} from "@/lib/mesh-plan";

const CACHE_VERSION = 1;
const LATEST_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 15 * 60 * 1000;

interface StoredGrid {
  version: number;
  key: string;
  product: string;
  validTime: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  label: string;
  west: number;
  south: number;
  step: number;
  nx: number;
  ny: number;
  cells: Array<[number, number, number]>;
  missing?: boolean;
  note?: string;
}

export interface LoadedGrid {
  key: string;
  date: string | null;
  label: string;
  product: string;
  validTime: string | null;
  sourceUrl: string | null;
  shape: MeshGridShape;
  cells: MeshCell[];
  status: "ok" | "empty" | "error";
  error?: string;
}

const memory = new Map<string, StoredGrid>();
const inflight = new Map<string, Promise<StoredGrid>>();

function cacheFile(key: string): string {
  return path.join(dataDir(), "mesh", `${key.replace(/[^a-z0-9-]/gi, "_")}.json`);
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

async function fetchGrib(url: string): Promise<Buffer | null> {
  return pace(hostOf(url), gapFor(url), async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/octet-stream,*/*" },
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 64) return null;
    return bytes;
  });
}

async function listedDayUrls(convectiveDate: string): Promise<string[]> {
  const page = meshArchivePage(convectiveDate);
  try {
    const html = await pace(hostOf(page), gapFor(page), async () => {
      const response = await fetch(page, {
        headers: { "User-Agent": userAgent(), Accept: "text/html" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) return "";
      return response.text();
    });
    const names = [...html.matchAll(/href="([^"]+)"/g)].map((match) => decodeURIComponent(match[1].split("/").pop() ?? ""));
    const best = pickMeshArchiveName(names);
    return best ? [new URL(best, page).href] : [];
  } catch (error) {
    console.error("[hailmap] mesh list", error instanceof Error ? error.message : error);
    return [];
  }
}

function rememberMeshDay(stored: StoredGrid) {
  if (!stored.key.startsWith("day-") || stored.missing) return;
  const date = stored.key.slice(4);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || meshDayReady(date)) return;
  const step = stored.step || 0.02;
  const cells = stored.cells.map(([ix, iy, inches]) => ({
    lat: stored.south + (iy + 0.5) * step,
    lon: stored.west + (ix + 0.5) * step,
    inches,
  }));
  try {
    recordMeshGrid(date, cells);
  } catch (error) {
    console.error("[hailmap] mesh index", error instanceof Error ? error.message : error);
  }
}

function storedFromGrib(key: string, label: string, product: string, sourceUrl: string, bytes: Buffer): StoredGrid {
  const decoded = readGribMesh(gunzipIfNeeded(bytes));
  return {
    version: CACHE_VERSION,
    key,
    product,
    validTime: decoded.validTime,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    label,
    west: decoded.shape.west,
    south: decoded.shape.south,
    step: decoded.shape.step,
    nx: decoded.shape.nx,
    ny: decoded.shape.ny,
    cells: decoded.cells.map((cell) => [cell.ix, cell.iy, cell.inches]),
  };
}

function miss(key: string, label: string, product: string, note: string): StoredGrid {
  return {
    version: CACHE_VERSION,
    key,
    product,
    validTime: null,
    sourceUrl: null,
    fetchedAt: new Date().toISOString(),
    label,
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

async function loadKey(
  key: string,
  ttl: number | null,
  label: string,
  product: string,
  urls: string[],
  more?: () => Promise<string[]>,
): Promise<StoredGrid> {
  const cached = readStored(key);
  if (cached && fresh(cached, cached.missing ? MISS_TTL_MS : ttl)) {
    rememberMeshDay(cached);
    return cached;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    let lastError = "Radar file was not found";
    const readUrls = async (queue: string[]) => {
      for (const url of queue) {
        try {
          const bytes = await fetchGrib(url);
          if (!bytes) continue;
          const stored = storedFromGrib(key, label, product, url, bytes);
          writeStored(stored);
          rememberMeshDay(stored);
          return stored;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Radar file could not be read";
          console.error("[hailmap] mesh", url, lastError);
        }
      }
      return null;
    };
    const direct = await readUrls(urls);
    if (direct) return direct;
    if (more) {
      const extra = await more().catch(() => [] as string[]);
      const listed = await readUrls(extra.filter((url) => !urls.includes(url)));
      if (listed) return listed;
    }
    if (cached && !cached.missing) {
      rememberMeshDay(cached);
      return cached;
    }
    const failed = miss(key, label, product, lastError);
    writeStored(failed);
    return failed;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

function asLoaded(stored: StoredGrid, date: string | null, label = stored.label): LoadedGrid {
  const shape: MeshGridShape = {
    west: stored.west,
    south: stored.south,
    step: stored.step || 0.02,
    nx: stored.nx,
    ny: stored.ny,
  };
  if (stored.missing) {
    return {
      key: stored.key,
      date,
      label,
      product: stored.product,
      validTime: null,
      sourceUrl: null,
      shape,
      cells: [],
      status: "error",
      error: stored.note ?? "Radar file was not found",
    };
  }
  const cells = stored.cells.map(([ix, iy, inches]) => ({ ix, iy, inches }));
  return {
    key: stored.key,
    date,
    label,
    product: stored.product,
    validTime: stored.validTime,
    sourceUrl: stored.sourceUrl,
    shape,
    cells,
    status: cells.some((cell) => cell.inches >= 0.75) ? "ok" : "empty",
  };
}

export async function loadPlanGrids(plan: MeshRequestPlan, now = new Date()): Promise<LoadedGrid[]> {
  if (plan.mode === "latest-60" || plan.mode === "latest-1440") {
    const which = plan.mode === "latest-60" ? "60" : "1440";
    const stored = await loadKey(
      plan.mode,
      LATEST_TTL_MS,
      plan.label,
      plan.product,
      [LATEST_MESH_URL[which]],
    );
    return [asLoaded(stored, null, plan.label)];
  }

  const today = isoDateUTC(now);
  const grids: LoadedGrid[] = [];
  const queue = [...plan.dates];
  const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
    while (queue.length) {
      const date = queue.shift();
      if (!date) return;
      if (date === today) {
        const stored = await loadKey("latest-1440", LATEST_TTL_MS, formatStormDate(date), "MESH_Max_1440min", [
          LATEST_MESH_URL["1440"],
        ]);
        grids.push(asLoaded(stored, date, formatStormDate(date)));
        continue;
      }
      const stored = await loadKey(`day-${date}`, null, formatStormDate(date), "MESH_Max_1440min", dayFetchUrls(date, now), () =>
        listedDayUrls(date),
      );
      grids.push(asLoaded(stored, date));
    }
  });
  await Promise.all(workers);
  grids.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return grids;
}

function mergeCells(grids: LoadedGrid[]): { shape: MeshGridShape; cells: MeshCell[] } | null {
  const base = grids.find((grid) => grid.shape.nx > 0);
  if (!base) return null;
  const index = new Map<number, number>();
  for (const grid of grids) {
    for (const cell of grid.cells) {
      const key = cell.ix + cell.iy * base.shape.nx;
      const prev = index.get(key);
      if (prev == null || cell.inches > prev) index.set(key, cell.inches);
    }
  }
  const cells: MeshCell[] = [];
  for (const [key, inches] of index) {
    cells.push({ ix: key % base.shape.nx, iy: Math.floor(key / base.shape.nx), inches });
  }
  return { shape: base.shape, cells };
}

function layerStatus(grids: LoadedGrid[], featureCount: number): "ok" | "empty" | "partial" | "error" {
  const ok = grids.filter((grid) => grid.status !== "error");
  if (!ok.length) return "error";
  if (ok.length < grids.length) return featureCount ? "partial" : "partial";
  return featureCount ? "ok" : "empty";
}

export async function meshLayerFor(plan: MeshRequestPlan, now = new Date()) {
  const grids = await loadPlanGrids(plan, now);
  const merged = mergeCells(grids.filter((grid) => grid.status !== "error"));
  const validTime = grids.map((grid) => grid.validTime).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const collection = merged
    ? cellsToSwaths(merged.cells, merged.shape, { product: plan.product, validTime, label: plan.label })
    : ({ type: "FeatureCollection", features: [] } as FeatureCollection);
  const status = layerStatus(grids, collection.features.length);
  const problem = grids.find((grid) => grid.error)?.error;
  const note =
    status === "error"
      ? problem ?? "Radar hail is unavailable right now."
      : collection.features.length
        ? plan.note
        : `${plan.note} No hail at or above 0.75 in in this window.`;
  const bounds = swathBounds(collection);
  return {
    status,
    label: plan.label,
    product: plan.product,
    validTime,
    note,
    legend: MESH_LEGEND.map((band) => ({ ...band })),
    collection,
    bounds: bounds
      ? {
          west: bounds.west - 0.4,
          south: bounds.south - 0.3,
          east: bounds.east + 0.4,
          north: bounds.north + 0.3,
        }
      : null,
  };
}

export async function radarSampleFor(plan: MeshRequestPlan, lat: number, lon: number, now = new Date()): Promise<RadarSample> {
  const grids = await loadPlanGrids(plan, now);
  const days = grids.map((grid) => {
    const indexed = grid.cells.length && grid.shape.nx ? indexCells(grid.cells, grid.shape) : null;
    const maxIn = indexed ? sampleIndexed(indexed, grid.shape, lat, lon) : null;
    return {
      date: grid.date,
      label: grid.label,
      maxIn,
      validTime: grid.validTime,
      product: grid.product,
      status: grid.status === "error" ? ("error" as const) : maxIn == null ? ("empty" as const) : ("ok" as const),
    };
  });
  let maxIn: number | null = null;
  for (const day of days) {
    if (day.maxIn == null) continue;
    maxIn = maxIn == null ? day.maxIn : Math.max(maxIn, day.maxIn);
  }
  const failed = grids.filter((grid) => grid.status === "error").length;
  const status = !grids.length || failed === grids.length ? "error" : failed ? "partial" : maxIn == null ? "empty" : "ok";
  const note =
    status === "error"
      ? "Radar MESH could not be read for this window."
      : maxIn == null
        ? `${plan.note} Nothing at or above 0.50 in covers this point.`
        : plan.note;
  return { status, maxIn, days, note, label: plan.label };
}

/** Exact MESH cell under each point, one grid load for the whole list. */
export async function meshAtPoints(
  plan: MeshRequestPlan,
  points: Array<{ lat: number; lon: number }>,
  now = new Date(),
): Promise<Array<number | null>> {
  const grids = await loadPlanGrids(plan, now);
  const indexed = grids
    .filter((grid) => grid.status !== "error" && grid.cells.length && grid.shape.nx)
    .map((grid) => ({ shape: grid.shape, index: indexCells(grid.cells, grid.shape) }));
  return points.map((point) => {
    let max: number | null = null;
    for (const grid of indexed) {
      const value = sampleCell(grid.index, grid.shape, point.lat, point.lon);
      if (value == null) continue;
      max = max == null ? value : Math.max(max, value);
    }
    return max;
  });
}

/** Swaths near a point, for the printable map. Uses the same cached grids as the sample. */
export async function radarSwathsNear(plan: MeshRequestPlan, lat: number, lon: number, now = new Date()): Promise<FeatureCollection> {
  const grids = await loadPlanGrids(plan, now);
  const merged = mergeCells(grids.filter((grid) => grid.status !== "error"));
  if (!merged) return { type: "FeatureCollection", features: [] };
  const validTime = grids.map((grid) => grid.validTime).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const collection = cellsToSwaths(merged.cells, merged.shape, { product: plan.product, validTime, label: plan.label });
  const pad = 0.8;
  collection.features = collection.features.filter((feature) => {
    const bounds = swathBounds({ type: "FeatureCollection", features: [feature] });
    if (!bounds) return false;
    return bounds.east >= lon - pad && bounds.west <= lon + pad && bounds.north >= lat - pad && bounds.south <= lat + pad;
  });
  return collection;
}

export interface MeshIndexResult {
  status: "ok" | "empty" | "miss" | "error" | "budget" | "outside";
  cells: number;
  product: string;
}

function pointsFromDecoded(decoded: ReturnType<typeof readGribMesh>): Array<{ lat: number; lon: number; inches: number }> {
  const { step, south, west } = decoded.shape;
  return decoded.cells.map((cell) => ({
    lat: south + (cell.iy + 0.5) * step,
    lon: west + (cell.ix + 0.5) * step,
    inches: cell.inches,
  }));
}

async function listGribNames(page: string): Promise<string[]> {
  try {
    const html = await pace(hostOf(page), gapFor(page), async () => {
      const response = await fetch(page, {
        headers: { "User-Agent": userAgent(), Accept: "text/html" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) return "";
      return response.text();
    });
    return [...html.matchAll(/href="([^"]+\.grib2\.gz)"/gi)].map((match) => decodeURIComponent(match[1].split("/").pop() ?? ""));
  } catch (error) {
    console.error("[hailmap] mesh list", error instanceof Error ? error.message : error);
    return [];
  }
}

async function storeDecodedDay(
  date: string,
  product: string,
  points: Array<{ lat: number; lon: number; inches: number }>,
  existingCells: number,
): Promise<MeshIndexResult> {
  const incoming = new Set(
    points.filter((point) => point.inches >= 0.5).map((point) => `${Math.round(point.lat * 10)}:${Math.round(point.lon * 10)}`),
  ).size;
  if (meshStoreDecision(existingCells, incoming, meshBudgetBytes()) === "stop") {
    return { status: "budget", cells: incoming, product };
  }
  const cells = recordMeshGrid(date, points);
  return { status: cells > 0 ? "ok" : "empty", cells, product };
}

/**
 * Index one convective day into the coarse hail table and drop the GRIB.
 * Daily maximum when that product exists. Otherwise up to eight hourly MESH scans.
 */
export async function indexMeshDay(date: string, options?: { existingCells?: number }): Promise<MeshIndexResult> {
  const existingCells = options?.existingCells ?? 0;
  if (date < MESH_INSTANT_START) return { status: "outside", cells: 0, product: "none" };
  try {
    if (date >= MESH_ARCHIVE_START) {
      const urls = [...dayFetchUrls(date), ...(await listedDayUrls(date))];
      for (const url of urls) {
        const bytes = await fetchGrib(url);
        if (!bytes) continue;
        const decoded = readGribMesh(gunzipIfNeeded(bytes));
        return storeDecodedDay(date, "MESH_Max_1440min", pointsFromDecoded(decoded), existingCells);
      }
      return { status: "miss", cells: 0, product: "MESH_Max_1440min" };
    }
    const names = [
      ...(await listGribNames(meshDirectory(date, "MESH"))),
      ...(await listGribNames(meshDirectory(addIsoDays(date, 1), "MESH"))),
    ];
    const picked = pickHourlyMeshNames(date, names, 8);
    if (!picked.length) return { status: "miss", cells: 0, product: "MESH" };
    const merged = new Map<string, { lat: number; lon: number; inches: number }>();
    let read = 0;
    for (const name of picked) {
      const stamp = name.match(/(\d{4})(\d{2})(\d{2})-/);
      const folder = stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}` : date;
      const bytes = await fetchGrib(new URL(name, meshDirectory(folder, "MESH")).href);
      if (!bytes) continue;
      read += 1;
      for (const point of pointsFromDecoded(readGribMesh(gunzipIfNeeded(bytes)))) {
        const key = `${point.lat.toFixed(3)}:${point.lon.toFixed(3)}`;
        const prev = merged.get(key);
        if (!prev || point.inches > prev.inches) merged.set(key, point);
      }
    }
    if (!read) return { status: "miss", cells: 0, product: "MESH" };
    return storeDecodedDay(date, "MESH_hourly_sample", [...merged.values()], existingCells);
  } catch (error) {
    console.error("[hailmap] mesh index day", date, error instanceof Error ? error.message : error);
    return { status: "error", cells: 0, product: "MESH" };
  }
}
