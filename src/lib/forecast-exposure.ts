import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { resolveExposure, type ExposureTract, type ForecastQuery, type ForecastResult } from "@/lib/forecast";
import { loadRoofTracts, type RoofTract } from "@/lib/honey-census";
import type { HoneyBounds } from "@/lib/honey";
import { userAgent } from "@/lib/ingest";
import { pace } from "@/lib/paced";

const ACS_YEARS = [2023, 2022, 2021];
const ACS_TTL_MS = 30 * 24 * 3600 * 1000;

function vehicleCacheFile(state: string, county: string): string {
  return path.join(dataDir(), "honey", "census", `vehicles-${state}${county}.json`);
}

function readFresh(file: string): Record<string, number> | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { at?: number; data?: Record<string, number> };
    if (!parsed.at || !parsed.data) return null;
    if (Date.now() - parsed.at > ACS_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeFresh(file: string, data: Record<string, number>) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${createHash("sha1").update(file).digest("hex").slice(0, 6)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ at: Date.now(), data }));
  fs.renameSync(temporary, file);
}

function geoidOf(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "").slice(-11);
  return /^\d{11}$/.test(digits) ? digits : null;
}

/** data.census.gov B25046 rows, or the official [name, vehicles, state, county, tract] table. */
export function vehiclesFromCensus(payload: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (Array.isArray(payload)) {
    for (const row of payload.slice(1)) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const vehicles = Number(row[1]);
      const state = String(row[3] ?? "").padStart(2, "0");
      const county = String(row[4] ?? "").padStart(3, "0");
      const tract = String(row[5] ?? "").padStart(6, "0");
      if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county) || !/^\d{6}$/.test(tract)) continue;
      if (!Number.isFinite(vehicles) || vehicles < 0) continue;
      counts[`${state}${county}${tract}`] = Math.round(vehicles);
    }
    return counts;
  }
  const root = payload && typeof payload === "object" ? (payload as { response?: { data?: unknown } }) : null;
  const rows = root?.response?.data;
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) return counts;
  const header = rows[0].map((cell) => String(cell));
  const geoIdx = header.indexOf("GEO_ID");
  const vehIdx = header.indexOf("B25046_001E");
  if (geoIdx < 0 || vehIdx < 0) return counts;
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) continue;
    const geoid = geoidOf(row[geoIdx]);
    const raw = row[vehIdx];
    if (!geoid || raw == null || raw === "") continue;
    const vehicles = Number(raw);
    if (!Number.isFinite(vehicles) || vehicles < 0) continue;
    counts[geoid] = Math.round(vehicles);
  }
  return counts;
}

function walkCoords(coords: unknown, visit: (lon: number, lat: number) => void) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    visit(Number(coords[0]), Number(coords[1]));
    return;
  }
  for (const part of coords) walkCoords(part, visit);
}

export function geometryBounds(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, pad = 0.02): HoneyBounds | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  walkCoords(geometry.coordinates, (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });
  if (!Number.isFinite(west)) return null;
  return { west: west - pad, south: south - pad, east: east + pad, north: north + pad };
}

async function fetchCountyVehicles(state: string, county: string): Promise<Record<string, number>> {
  const file = vehicleCacheFile(state, county);
  const cached = readFresh(file);
  if (cached) return cached;
  const key = process.env.CENSUS_API_KEY?.trim();
  for (const year of ACS_YEARS) {
    const table = new URL("https://data.census.gov/api/access/data/table");
    table.searchParams.set("id", `ACSDT5Y${year}.B25046`);
    table.searchParams.set("g", `0500000US${state}${county}$1400000`);
    const official = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
    official.searchParams.set("get", "NAME,B25046_001E");
    official.searchParams.set("for", "tract:*");
    official.searchParams.set("in", `state:${state} county:${county}`);
    if (key) official.searchParams.set("key", key);
    const attempts = key ? [official, table] : [table];
    for (const url of attempts) {
      try {
        const response = await pace(url.host, 350, () =>
          fetch(url, {
            headers: { "User-Agent": userAgent(), Accept: "application/json" },
            signal: AbortSignal.timeout(20000),
            cache: "no-store",
            redirect: "follow",
          }),
        );
        if (!response.ok) continue;
        const counts = vehiclesFromCensus((await response.json()) as unknown);
        if (Object.keys(counts).length < 1) continue;
        writeFresh(file, counts);
        return counts;
      } catch (error) {
        console.error("[hailmap] forecast vehicles", state, county, error instanceof Error ? error.message : error);
      }
    }
  }
  return {};
}

async function vehiclesForTracts(tracts: RoofTract[]): Promise<{ byGeoid: Record<string, number>; partial: boolean }> {
  const counties = new Map<string, { state: string; county: string }>();
  for (const tract of tracts) {
    const state = tract.geoid.slice(0, 2);
    const county = tract.geoid.slice(2, 5);
    if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county)) continue;
    counties.set(`${state}${county}`, { state, county });
  }
  const byGeoid: Record<string, number> = {};
  let partial = false;
  let fetched = 0;
  for (const county of counties.values()) {
    const cached = readFresh(vehicleCacheFile(county.state, county.county));
    if (!cached && fetched >= 6) {
      partial = true;
      continue;
    }
    if (!cached) fetched += 1;
    const counts = cached ?? (await fetchCountyVehicles(county.state, county.county));
    if (!Object.keys(counts).length) partial = true;
    Object.assign(byGeoid, counts);
  }
  return { byGeoid, partial };
}

export async function loadForecastExposure(query: ForecastQuery): Promise<ForecastResult> {
  const bounds = geometryBounds(query.selection);
  let partial = false;
  let tracts: ExposureTract[] = [];
  if (bounds) {
    try {
      const roofs = await loadRoofTracts(bounds);
      partial = roofs.partial;
      if (!roofs.unavailable && roofs.tracts.length) {
        const vehicles = await vehiclesForTracts(roofs.tracts);
        if (vehicles.partial) partial = true;
        tracts = roofs.tracts.map((tract) => ({
          lat: tract.lat,
          lon: tract.lon,
          homes: tract.homes,
          vehicles: vehicles.byGeoid[tract.geoid] ?? null,
        }));
      }
    } catch (error) {
      partial = true;
      console.error("[hailmap] forecast exposure", error instanceof Error ? error.message : error);
    }
  }
  return resolveExposure(query, tracts, partial);
}
