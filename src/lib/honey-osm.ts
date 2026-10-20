import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { userAgent } from "@/lib/ingest";
import { pace } from "@/lib/paced";
import {
  MIN_PARKING_M2,
  gridTiles,
  inBounds,
  ringAreaM2,
  vehiclesFromArea,
  type HoneyBounds,
  type HoneyPlace,
  type TargetKind,
} from "@/lib/honey";

const MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const TILE_STEP = 0.36;
const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;
const EMPTY_TTL_MS = 12 * 3600 * 1000;
const MIRROR_TIMEOUT_MS = 28000;
const OVERPASS_GAP_MS = 1500;
/** Fresh Overpass calls per ranking so a metro view stays inside public rate limits. */
export const MAX_FRESH_TILES = 2;

const FLEET_NAME = /fleet|rental yard|enterprise|hertz|avis|budget|national car|u-haul|penske|ryder/i;
const SKIP_PARKING = new Set(["street_side", "lane", "layby", "roadside"]);

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
  geometry?: Array<{ lat?: number; lon?: number }>;
  members?: Array<{ role?: string; geometry?: Array<{ lat?: number; lon?: number }> }>;
}

export interface PlaceLabel {
  name: string;
  kind: "neighbourhood" | "suburb" | "quarter" | "city" | "town";
  lat: number;
  lon: number;
}

export interface OsmTileResult {
  targets: HoneyPlace[];
  places: PlaceLabel[];
  partial: boolean;
}

export function honeyOverpassQuery(bounds: HoneyBounds): string {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:25];
(
  nwr["shop"="car"](${box});
  way["amenity"="parking"](${box});
  way["building"="parking"](${box});
  nwr["building"="apartments"]["name"](${box});
  nwr["residential"="apartments"]["name"](${box});
  nwr["shop"="mall"](${box});
  nwr["building"="mall"](${box});
  nwr["amenity"="car_rental"](${box});
  nwr["industrial"="depot"](${box});
  node["place"~"^(suburb|neighbourhood|quarter|city|town)$"]["name"](${box});
);
out tags geom qt;`;
}

function finitePoint(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const y = Number(lat);
  const x = Number(lon);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  return { lat: y, lon: x };
}

function ringOf(points: Array<{ lat?: number; lon?: number }> | undefined): Array<[number, number]> {
  if (!points?.length) return [];
  const ring: Array<[number, number]> = [];
  for (const point of points) {
    const parsed = finitePoint(point.lat, point.lon);
    if (parsed) ring.push([parsed.lon, parsed.lat]);
  }
  if (ring.length >= 3) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  }
  return ring;
}

function elementArea(element: OverpassElement): number {
  const own = ringOf(element.geometry);
  if (own.length >= 4) return ringAreaM2(own);
  let area = 0;
  for (const member of element.members ?? []) {
    const role = (member.role ?? "").toLowerCase();
    if (role && role !== "outer") continue;
    const ring = ringOf(member.geometry);
    if (ring.length >= 4) area += ringAreaM2(ring);
  }
  return area;
}

function elementPoint(element: OverpassElement): { lat: number; lon: number } | null {
  const direct = finitePoint(element.lat, element.lon) ?? finitePoint(element.center?.lat, element.center?.lon);
  if (direct) return direct;
  const ring = ringOf(element.geometry);
  if (ring.length) {
    let lat = 0;
    let lon = 0;
    const open = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
    for (const [x, y] of open) {
      lon += x;
      lat += y;
    }
    return { lat: lat / open.length, lon: lon / open.length };
  }
  return null;
}

function levelsOf(tags: Record<string, string>): number {
  const raw = Number(tags["building:levels"] || tags.levels || "1");
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(8, Math.round(raw));
}

function apartmentHomes(tags: Record<string, string>, area: number): number {
  const flats = Number(tags["building:flats"] || tags["addr:flats"] || "");
  if (Number.isFinite(flats) && flats >= 4 && flats <= 4000) return Math.round(flats);
  const levels = Number(tags["building:levels"] || tags.levels || "");
  const floors = Number.isFinite(levels) && levels >= 1 ? Math.min(40, Math.round(levels)) : 0;
  if (area >= 250 && floors > 0) return Math.max(8, Math.min(2500, Math.round((area / 85) * floors)));
  if (floors > 1) return Math.min(800, floors * 8);
  return 28;
}

function cityOf(tags: Record<string, string>): string | null {
  const city = (tags["addr:city"] || tags["addr:suburb"] || "").trim();
  return city || null;
}

function neighborhoodOf(tags: Record<string, string>): string | null {
  const name = (tags["addr:neighbourhood"] || tags["addr:neighborhood"] || tags["addr:suburb"] || "").trim();
  return name || null;
}

function streetOf(tags: Record<string, string>): string | null {
  const street = (tags["addr:street"] || "").trim();
  if (!street || street.length > 42 || /^(parking|lot|garage)$/i.test(street)) return null;
  return street;
}

function classify(tags: Record<string, string>, area: number): { kind: TargetKind; vehicles: number; homes: number; basis: "area" | "default" } | null {
  if (tags.highway || tags.railway || tags.waterway) return null;
  const name = (tags.name || tags.brand || tags.operator || "").trim();
  const shop = tags.shop;
  const parking = tags.parking;
  if (shop === "car") {
    if (area >= 1200) return { kind: "dealership", vehicles: Math.max(70, vehiclesFromArea(area)), homes: 0, basis: "area" };
    return { kind: "dealership", vehicles: 90, homes: 0, basis: "default" };
  }
  if (tags.amenity === "car_rental" || tags.industrial === "depot" || (tags.amenity === "parking" && parking === "depot")) {
    if (area >= 800) return { kind: "fleet", vehicles: Math.max(30, vehiclesFromArea(area, levelsOf(tags))), homes: 0, basis: "area" };
    return { kind: "fleet", vehicles: 45, homes: 0, basis: "default" };
  }
  if (shop === "mall" || tags.building === "mall" || (tags.building === "retail" && /mall/i.test(name))) {
    if (area >= 8000) return { kind: "mall", vehicles: vehiclesFromArea(area), homes: 0, basis: "area" };
    return { kind: "mall", vehicles: 400, homes: 0, basis: "default" };
  }
  if (tags.building === "apartments" || tags.residential === "apartments") {
    if (!name) return null;
    const homes = apartmentHomes(tags, area);
    return { kind: "apartments", vehicles: Math.max(12, Math.round(homes * 0.85)), homes, basis: "default" };
  }
  const isLot = tags.amenity === "parking" || tags.building === "parking";
  if (!isLot) return null;
  if (parking && SKIP_PARKING.has(parking)) return null;
  if (area < MIN_PARKING_M2) return null;
  const stacked = parking === "multi-storey" || tags.building === "parking" ? levelsOf(tags) : 1;
  const vehicles = vehiclesFromArea(area, stacked);
  if (vehicles < 50) return null;
  if (FLEET_NAME.test(name)) return { kind: "fleet", vehicles, homes: 0, basis: "area" };
  return { kind: "parking", vehicles, homes: 0, basis: "area" };
}

export function targetsFromElements(elements: OverpassElement[], bounds?: HoneyBounds): { targets: HoneyPlace[]; places: PlaceLabel[] } {
  const targets: HoneyPlace[] = [];
  const places: PlaceLabel[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    const elementId = `${element.type ?? "n"}/${element.id ?? ""}`;
    if (element.id != null && seen.has(elementId)) continue;
    if (element.id != null) seen.add(elementId);
    const tags = element.tags ?? {};
    const point = elementPoint(element);
    if (!point) continue;
    if (bounds && !inBounds(point.lat, point.lon, bounds)) continue;
    const place = tags.place;
    if (place === "suburb" || place === "neighbourhood" || place === "quarter" || place === "city" || place === "town") {
      const name = (tags.name || "").trim();
      if (name) places.push({ name, kind: place, lat: point.lat, lon: point.lon });
      if (!tags.shop && !tags.amenity && !tags.building) continue;
    }
    const area = elementArea(element);
    const classified = classify(tags, area);
    if (!classified) continue;
    const name = (tags.name || tags.brand || tags.operator || "").trim();
    targets.push({
      id: `${element.type ?? "n"}/${element.id ?? targets.length}`,
      kind: classified.kind,
      name: name || null,
      city: cityOf(tags),
      neighborhood: neighborhoodOf(tags),
      street: streetOf(tags),
      lat: point.lat,
      lon: point.lon,
      vehicles: classified.vehicles,
      homes: classified.homes,
      vehicleBasis: classified.basis,
    });
  }
  targets.sort((a, b) => b.vehicles + b.homes - (a.vehicles + a.homes));
  const kept: HoneyPlace[] = [];
  for (const target of targets) {
    const duplicate = kept.some((other) => {
      if (other.kind !== target.kind) return false;
      const sameName = (other.name ?? "").toLowerCase() === (target.name ?? "").toLowerCase() && other.name;
      const close = Math.hypot(other.lat - target.lat, other.lon - target.lon) < 0.0016;
      return Boolean(sameName && close) || (close && !target.name && !other.name);
    });
    if (!duplicate) kept.push(target);
  }
  return { targets: kept, places };
}

function cacheFile(bounds: HoneyBounds): string {
  const key = createHash("sha1")
    .update([bounds.west.toFixed(3), bounds.south.toFixed(3), bounds.east.toFixed(3), bounds.north.toFixed(3)].join(","))
    .digest("hex")
    .slice(0, 20);
  return path.join(dataDir(), "honey", "osm", `${key}.json`);
}

function readCache(bounds: HoneyBounds): OverpassElement[] | null {
  const file = cacheFile(bounds);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { at?: number; elements?: OverpassElement[] };
    if (!parsed.at || !Array.isArray(parsed.elements)) return null;
    const ttl = parsed.elements.length ? CACHE_TTL_MS : EMPTY_TTL_MS;
    if (Date.now() - parsed.at > ttl) return null;
    return parsed.elements;
  } catch {
    return null;
  }
}

function writeCache(bounds: HoneyBounds, elements: OverpassElement[]) {
  const file = cacheFile(bounds);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ at: Date.now(), elements }));
  fs.renameSync(temporary, file);
}

async function queryMirror(query: string): Promise<OverpassElement[]> {
  let lastError = "Overpass is busy";
  for (const mirror of MIRRORS) {
    try {
      const response = await fetch(mirror, {
        method: "POST",
        headers: {
          "User-Agent": userAgent(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
        cache: "no-store",
      });
      if (response.status === 429 || response.status === 504 || response.status === 503 || response.status === 400) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const payload = (await response.json()) as {
        elements?: OverpassElement[];
        remark?: string;
        osm3s?: { timestamp_osm_base?: string };
      };
      const stamp = payload.osm3s?.timestamp_osm_base ?? "";
      if (payload.remark && /error|timeout/i.test(payload.remark) && !payload.elements?.length) {
        lastError = payload.remark;
        continue;
      }
      if (!payload.elements?.length && stamp && !/^\d{4}-\d{2}-\d{2}/.test(stamp)) {
        lastError = "Overpass mirror returned an empty dataset";
        continue;
      }
      return payload.elements ?? [];
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Overpass failed";
      console.error("[hailmap] honey overpass", mirror, lastError);
    }
  }
  throw new Error(lastError);
}

async function fetchTile(bounds: HoneyBounds): Promise<OverpassElement[]> {
  const cached = readCache(bounds);
  if (cached) return cached;
  const elements = await pace("overpass", OVERPASS_GAP_MS, () => queryMirror(honeyOverpassQuery(bounds)));
  writeCache(bounds, elements);
  return elements;
}

export async function loadOsmTargets(
  bounds: HoneyBounds,
  hailAtTile: (tile: HoneyBounds) => number,
): Promise<OsmTileResult> {
  const tiles = gridTiles(bounds, TILE_STEP)
    .map((tile) => ({ tile, hail: hailAtTile(tile) }))
    .filter((item) => item.hail >= 0.75)
    .sort((a, b) => b.hail - a.hail)
    .map((item) => item.tile);
  const elements: OverpassElement[] = [];
  let fresh = 0;
  let partial = false;
  for (const tile of tiles) {
    const cached = readCache(tile);
    if (cached) {
      elements.push(...cached);
      continue;
    }
    if (fresh >= MAX_FRESH_TILES) {
      partial = true;
      continue;
    }
    fresh += 1;
    try {
      elements.push(...(await fetchTile(tile)));
    } catch (error) {
      partial = true;
      console.error("[hailmap] honey tile", error instanceof Error ? error.message : error);
    }
  }
  const parsed = targetsFromElements(elements, bounds);
  return { ...parsed, partial };
}
