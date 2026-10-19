import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { userAgent } from "@/lib/ingest";
import { pace } from "@/lib/paced";
import type { HoneyBounds } from "@/lib/honey";

const TRACT_URLS = [
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query",
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer/8/query",
];

const ACS_YEARS = [2023, 2022, 2021];
const TRACT_TTL_MS = 30 * 24 * 3600 * 1000;
const ACS_TTL_MS = 30 * 24 * 3600 * 1000;

export interface RoofTract {
  geoid: string;
  basename: string;
  county: string | null;
  lat: number;
  lon: number;
  homes: number;
}

interface TractSeed {
  geoid: string;
  basename: string;
  state: string;
  county: string;
  lat: number;
  lon: number;
}

interface AcsCounts {
  housingUnits: number | null;
  households: number | null;
}

function tractCacheFile(bounds: HoneyBounds): string {
  const key = createHash("sha1")
    .update([bounds.west.toFixed(1), bounds.south.toFixed(1), bounds.east.toFixed(1), bounds.north.toFixed(1)].join(","))
    .digest("hex")
    .slice(0, 20);
  return path.join(dataDir(), "honey", "census", `tracts-${key}.json`);
}

function acsCacheFile(state: string, county: string): string {
  return path.join(dataDir(), "honey", "census", `acs-${state}${county}.json`);
}

function readFresh<T>(file: string, ttl: number): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { at?: number; data?: T };
    if (!parsed.at || parsed.data == null) return null;
    if (Date.now() - parsed.at > ttl) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeFresh(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ at: Date.now(), data }));
  fs.renameSync(temporary, file);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Tract centroids from a TIGERweb JSON or GeoJSON payload. */
export function tractsFromTiger(payload: unknown): TractSeed[] {
  const root = asRecord(payload);
  if (!root) return [];
  const features = Array.isArray(root.features) ? root.features : [];
  const seeds: TractSeed[] = [];
  for (const feature of features) {
    const row = asRecord(feature);
    if (!row) continue;
    const props = asRecord(row.attributes) ?? asRecord(row.properties) ?? {};
    const geoid = text(props.GEOID ?? props.geoid).padStart(11, "0");
    if (!/^\d{11}$/.test(geoid)) continue;
    const centroid = asRecord(row.centroid);
    const geometry = asRecord(row.geometry);
    let lon = Number(centroid?.x);
    let lat = Number(centroid?.y);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      const coordinates = geometry?.coordinates;
      const rings = geometry?.rings;
      if (geometry?.type === "Point" && Array.isArray(coordinates)) {
        lon = Number(coordinates[0]);
        lat = Number(coordinates[1]);
      } else if (Array.isArray(rings) && Array.isArray(rings[0])) {
        const ring = rings[0] as unknown[];
        const last = ring.length > 1 ? ring[ring.length - 1] : null;
        const first = ring[0];
        const open =
          Array.isArray(first) &&
          Array.isArray(last) &&
          Number(first[0]) === Number(last[0]) &&
          Number(first[1]) === Number(last[1])
            ? ring.slice(0, -1)
            : ring;
        let sumLon = 0;
        let sumLat = 0;
        let count = 0;
        for (const pair of open) {
          if (!Array.isArray(pair)) continue;
          const x = Number(pair[0]);
          const y = Number(pair[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          sumLon += x;
          sumLat += y;
          count += 1;
        }
        if (count) {
          lon = sumLon / count;
          lat = sumLat / count;
        }
      } else {
        lon = Number(geometry?.x);
        lat = Number(geometry?.y);
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const basename = text(props.BASENAME ?? props.basename ?? props.NAME ?? props.name) || geoid.slice(5);
    seeds.push({
      geoid,
      basename: basename.replace(/^Census Tract\s+/i, ""),
      state: geoid.slice(0, 2),
      county: geoid.slice(2, 5),
      lat,
      lon,
    });
  }
  return seeds;
}

/** ACS rows: [name, housing units, households, state, county, tract]. */
export function countsFromAcs(rows: unknown): Record<string, AcsCounts> {
  const counts: Record<string, AcsCounts> = {};
  if (!Array.isArray(rows)) return counts;
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const housing = Number(row[1]);
    const households = Number(row[2]);
    const state = text(row[3]).padStart(2, "0");
    const county = text(row[4]).padStart(3, "0");
    const tract = text(row[5]).padStart(6, "0");
    if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county) || !/^\d{6}$/.test(tract)) continue;
    counts[`${state}${county}${tract}`] = {
      housingUnits: Number.isFinite(housing) && housing > 0 ? housing : null,
      households: Number.isFinite(households) && households > 0 ? households : null,
    };
  }
  return counts;
}

export function tractsWithHomes(seeds: TractSeed[], counts: Record<string, AcsCounts>, countyNames: Record<string, string>): RoofTract[] {
  const tracts: RoofTract[] = [];
  for (const seed of seeds) {
    const count = counts[seed.geoid];
    const homes = count?.housingUnits ?? count?.households ?? 0;
    if (homes <= 0) continue;
    tracts.push({
      geoid: seed.geoid,
      basename: seed.basename,
      county: countyNames[`${seed.state}${seed.county}`] ?? null,
      lat: seed.lat,
      lon: seed.lon,
      homes: Math.round(homes),
    });
  }
  return tracts;
}

async function fetchTiger(bounds: HoneyBounds): Promise<TractSeed[]> {
  const file = tractCacheFile(bounds);
  const cached = readFresh<TractSeed[]>(file, TRACT_TTL_MS);
  if (cached) return cached;
  const geometry = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  let lastError = "Census tracts are unavailable";
  for (const base of TRACT_URLS) {
    const url = new URL(base);
    url.searchParams.set("geometry", geometry);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "GEOID,BASENAME,NAME,STATE,COUNTY");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("f", "json");
    url.searchParams.set("resultRecordCount", "2000");
    url.searchParams.set("maxAllowableOffset", "0.008");
    try {
      const response = await pace("tigerweb.geo.census.gov", 400, () =>
        fetch(url, {
          headers: { "User-Agent": userAgent(), Accept: "application/json" },
          signal: AbortSignal.timeout(25000),
          cache: "no-store",
        }),
      );
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const payload = (await response.json()) as unknown;
      const seeds = tractsFromTiger(payload);
      if (!seeds.length) {
        lastError = "No tracts in this view";
        continue;
      }
      writeFresh(file, seeds);
      return seeds;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      console.error("[hailmap] honey tracts", lastError);
    }
  }
  throw new Error(lastError);
}

interface AcsFile {
  counts: Record<string, AcsCounts>;
  countyName: string | null;
}

export function countyNameFromAcs(rows: unknown): string | null {
  if (!Array.isArray(rows) || !Array.isArray(rows[1])) return null;
  const parts = String(rows[1][0] ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] || null;
}

/** data.census.gov table rows: GEO_ID, B25001_001E housing units, NAME. */
export function countsFromDataCensus(payload: unknown): AcsFile {
  const root = asRecord(payload);
  const response = asRecord(root?.response);
  const rows = response?.data;
  const counts: Record<string, AcsCounts> = {};
  let countyName: string | null = null;
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) return { counts, countyName };
  const header = rows[0].map((cell) => String(cell));
  const geoIdx = header.indexOf("GEO_ID");
  const unitsIdx = header.indexOf("B25001_001E");
  const nameIdx = header.indexOf("NAME");
  if (geoIdx < 0 || unitsIdx < 0) return { counts, countyName };
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) continue;
    const geoid = String(row[geoIdx] ?? "").replace(/\D/g, "").slice(-11);
    const homes = Number(row[unitsIdx]);
    if (!/^\d{11}$/.test(geoid) || !Number.isFinite(homes) || homes <= 0) continue;
    counts[geoid] = { housingUnits: Math.round(homes), households: null };
    if (!countyName && nameIdx >= 0) {
      const parts = String(row[nameIdx] ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      countyName = parts.length >= 2 ? parts[parts.length - 2] : null;
    }
  }
  return { counts, countyName };
}

async function fetchAcsCounty(state: string, county: string): Promise<AcsFile> {
  const file = acsCacheFile(state, county);
  const cached = readFresh<AcsFile>(file, ACS_TTL_MS);
  if (cached?.counts) return cached;
  const key = process.env.CENSUS_API_KEY?.trim();
  let lastError = "ACS home counts are unavailable";
  for (const year of ACS_YEARS) {
    const table = new URL("https://data.census.gov/api/access/data/table");
    table.searchParams.set("id", `ACSDT5Y${year}.B25001`);
    table.searchParams.set("g", `0500000US${state}${county}$1400000`);
    const official = new URL(`https://api.census.gov/data/${year}/acs/acs5`);
    official.searchParams.set("get", "NAME,B25001_001E,B11001_001E");
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
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }
        const body = (await response.json()) as unknown;
        const stored = Array.isArray(body)
          ? { counts: countsFromAcs(body), countyName: countyNameFromAcs(body) }
          : countsFromDataCensus(body);
        if (Object.keys(stored.counts).length < 3) {
          lastError = "ACS returned no tracts";
          continue;
        }
        writeFresh(file, stored);
        return stored;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
        console.error("[hailmap] honey acs", state, county, lastError);
      }
    }
  }
  throw new Error(lastError);
}

export async function loadRoofTracts(bounds: HoneyBounds): Promise<{ tracts: RoofTract[]; partial: boolean; unavailable: boolean }> {
  let seeds: TractSeed[] = [];
  try {
    seeds = await fetchTiger(bounds);
  } catch (error) {
    console.error("[hailmap] honey census", error instanceof Error ? error.message : error);
    return { tracts: [], partial: false, unavailable: true };
  }
  const counties = new Map<string, { state: string; county: string }>();
  for (const seed of seeds) counties.set(`${seed.state}${seed.county}`, { state: seed.state, county: seed.county });
  const counts: Record<string, AcsCounts> = {};
  const countyNames: Record<string, string> = {};
  let partial = false;
  let fetched = 0;
  for (const [id, county] of counties) {
    const cached = readFresh<AcsFile>(acsCacheFile(county.state, county.county), ACS_TTL_MS);
    if (!cached && fetched >= 3) {
      partial = true;
      continue;
    }
    try {
      if (!cached) fetched += 1;
      const file = cached ?? (await fetchAcsCounty(county.state, county.county));
      Object.assign(counts, file.counts);
      if (file.countyName) countyNames[id] = file.countyName;
    } catch (error) {
      partial = true;
      console.error("[hailmap] honey acs", id, error instanceof Error ? error.message : error);
    }
  }
  return { tracts: tractsWithHomes(seeds, counts, countyNames), partial, unavailable: false };
}
