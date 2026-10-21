import fs from "node:fs";
import path from "node:path";
import { isDirectionalDivision, townFromLocation } from "@/lib/chase-place";
import type { ChaseHit } from "@/lib/chase-week";
import { dataDir } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { userAgent } from "@/lib/ingest";
import { pace } from "@/lib/paced";

const TOWN_TTL_MS = 30 * 24 * 3600 * 1000;
const MISS_TTL_MS = 12 * 3600 * 1000;
const TOWN_RADIUS_KM = 45;
const MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

interface CensusRow {
  NAME?: string;
  BASENAME?: string;
  LSADC?: string;
}

interface TownCache {
  at: number;
  town: string | null;
}

function hailOf(hit: ChaseHit): number {
  return Math.max(hit.radarIn ?? 0, hit.spotterIn ?? 0);
}

function cacheFile(lat: number, lon: number): string {
  return path.join(dataDir(), "chase", "towns", `${lat.toFixed(2)},${lon.toFixed(2)}.json`);
}

function readTown(file: string): string | null | undefined {
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as TownCache;
    if (!parsed.at) return undefined;
    const ttl = parsed.town ? TOWN_TTL_MS : MISS_TTL_MS;
    if (Date.now() - parsed.at > ttl) return undefined;
    return parsed.town ?? null;
  } catch {
    return undefined;
  }
}

function writeTown(file: string, town: string | null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ at: Date.now(), town }));
  fs.renameSync(temporary, file);
}

function rowName(row: CensusRow): string | null {
  const base = (row.BASENAME || row.NAME || "").replace(/\s+(?:city|town|village|cdp|ccd)$/i, "").trim();
  return townFromLocation(base);
}

function rowsOf(geographies: Record<string, unknown>, key: string): CensusRow[] {
  const rows = geographies[key];
  return Array.isArray(rows) ? (rows as CensusRow[]) : [];
}

/**
 * Incorporated place, then a census designated place, then a county subdivision
 * that is actually a town. Directional CCD names such as "West Terrell" are skipped.
 */
export function townFromCensusGeographies(payload: unknown): string | null {
  const geographies = (payload as { result?: { geographies?: Record<string, unknown> } } | null)?.result?.geographies;
  if (!geographies) return null;
  for (const row of rowsOf(geographies, "Incorporated Places")) {
    const name = rowName(row);
    if (name) return name;
  }
  for (const row of rowsOf(geographies, "Census Designated Places")) {
    const name = rowName(row);
    if (name && !isDirectionalDivision(name)) return name;
  }
  for (const row of rowsOf(geographies, "County Subdivisions")) {
    const name = rowName(row);
    if (!name) continue;
    const lsadc = String(row.LSADC ?? "");
    if (lsadc === "22" && isDirectionalDivision(name)) continue;
    if (lsadc === "22" || lsadc === "43" || lsadc === "25" || lsadc === "21" || lsadc === "47") return name;
  }
  return null;
}

interface OsmNode {
  lat?: number;
  lon?: number;
  tags?: { name?: string; place?: string };
}

/** Nearest city, town, or village within the search radius. */
export function nearestTownName(elements: unknown, lat: number, lon: number, maxKm = TOWN_RADIUS_KM): string | null {
  if (!Array.isArray(elements)) return null;
  let best: { name: string; distance: number } | null = null;
  for (const element of elements as OsmNode[]) {
    const place = element.tags?.place;
    if (place !== "city" && place !== "town" && place !== "village") continue;
    const name = townFromLocation(element.tags?.name);
    const y = Number(element.lat);
    const x = Number(element.lon);
    if (!name || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    const distance = haversineKm(lat, lon, y, x);
    if (distance > maxKm) continue;
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best?.name ?? null;
}

async function censusTown(lat: number, lon: number): Promise<string | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.searchParams.set("x", lon.toFixed(5));
  url.searchParams.set("y", lat.toFixed(5));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");
  const response = await pace(url.host, 200, () =>
    fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    }),
  );
  if (!response.ok) return null;
  return townFromCensusGeographies(await response.json());
}

async function overpassTown(lat: number, lon: number): Promise<string | null> {
  const query = `[out:json][timeout:25];
node(around:${TOWN_RADIUS_KM * 1000},${lat},${lon})["place"~"^(city|town|village)$"]["name"];
out body qt;`;
  let lastError = "Overpass is busy";
  for (const mirror of MIRRORS) {
    try {
      const response = await pace("overpass", 1500, () =>
        fetch(mirror, {
          method: "POST",
          headers: {
            "User-Agent": userAgent(),
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(28000),
          cache: "no-store",
        }),
      );
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const payload = (await response.json()) as { elements?: unknown };
      return nearestTownName(payload.elements, lat, lon);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

async function townAt(lat: number, lon: number): Promise<string | null> {
  const file = cacheFile(lat, lon);
  const cached = readTown(file);
  if (cached !== undefined) return cached;
  let town: string | null = null;
  let resolved = false;
  try {
    town = await censusTown(lat, lon);
    resolved = true;
  } catch (error) {
    console.error("[hailmap] chase town", error instanceof Error ? error.message : error);
  }
  if (!town) {
    try {
      town = await overpassTown(lat, lon);
      resolved = true;
    } catch (error) {
      console.error("[hailmap] chase town", error instanceof Error ? error.message : error);
    }
  }
  if (resolved) writeTown(file, town);
  return town;
}

/** Stamp each area's biggest stone with the nearest town before that area is ranked. */
export async function stampClusterTowns(clusters: Array<{ hits: ChaseHit[] }>): Promise<void> {
  for (const cluster of clusters) {
    const peak = cluster.hits.reduce((best, hit) => (hailOf(hit) > hailOf(best) ? hit : best));
    if (peak.location?.trim()) continue;
    const town = await townAt(peak.lat, peak.lon);
    if (town) peak.location = town;
  }
}
