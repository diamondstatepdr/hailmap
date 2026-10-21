import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DealerPin } from "@/lib/area-selection";
import { dataDir } from "@/lib/db";
import { haversineKm, pointInGeometry, ringSpanKm } from "@/lib/geo";
import { userAgent } from "@/lib/ingest";

const MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const MIRROR_TIMEOUT_MS = 12000;

const VEHICLE_NAME =
  /dealer|motors|auto mall|autoplex|car lot|toyota|honda|ford|chevrolet|chevy|nissan|hyundai|kia|bmw|mercedes|volkswagen|subaru|mazda|jeep|gmc|buick|cadillac|lexus|acura|audi|volvo|chrysler|dodge|lincoln|mitsubishi|ram\b/i;

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

export function geometryBounds(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): {
  west: number;
  south: number;
  east: number;
  north: number;
} | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (ring: number[][]) => {
    for (const pair of ring) {
      const lon = Number(pair[0]);
      const lat = Number(pair[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  };
  if (geometry.type === "Polygon") geometry.coordinates.forEach(visit);
  else geometry.coordinates.forEach((polygon) => polygon.forEach(visit));
  if (!Number.isFinite(west) || west >= east || south >= north) return null;
  return { west, south, east, north };
}

export function overpassQuery(bounds: { west: number; south: number; east: number; north: number }): string {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:12];
(
  nwr["shop"="car"](${box});
  nwr["shop"="truck"](${box});
  way["amenity"="parking"]["name"~"dealer|motors|auto mall|autoplex|car lot",i](${box});
);
out center tags 80;`;
}

function phoneOf(tags: Record<string, string>): string | null {
  const raw = (tags.phone || tags["contact:phone"] || tags["phone:mobile"] || "").trim().replace(/\s+/g, " ");
  if (raw.length < 7 || raw.length > 40) return null;
  return raw;
}

function addressOf(tags: Record<string, string>): string {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const region = [tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(" ");
  const city = [tags["addr:city"], region].filter(Boolean).join(", ");
  const line = [street, city].filter(Boolean).join(", ");
  return line || "Address not listed in OpenStreetMap";
}

function pointOf(element: OverpassElement): { lat: number; lon: number } | null {
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function dealersFromElements(
  elements: OverpassElement[],
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  near: { lat: number; lon: number },
): DealerPin[] {
  const dealers: DealerPin[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (tags.highway || tags.railway || tags.waterway) continue;
    const point = pointOf(element);
    if (!point || !pointInGeometry(point.lon, point.lat, geometry)) continue;
    const shop = tags.shop;
    const name = (tags.name || tags.brand || tags.operator || "").trim();
    const parkingLot = tags.amenity === "parking";
    const dealership = shop === "car" || shop === "truck";
    if (!dealership && !(parkingLot && VEHICLE_NAME.test(name))) continue;
    if (!name) continue;
    dealers.push({
      id: `${element.type ?? "n"}/${element.id ?? dealers.length}`,
      name,
      address: addressOf(tags),
      lat: point.lat,
      lon: point.lon,
      distanceKm: haversineKm(near.lat, near.lon, point.lat, point.lon),
      kind: dealership ? "dealership" : "lot",
      phone: phoneOf(tags),
    });
  }
  dealers.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
  const kept: DealerPin[] = [];
  for (const dealer of dealers) {
    const duplicate = kept.some(
      (other) => other.name.toLowerCase() === dealer.name.toLowerCase() && haversineKm(other.lat, other.lon, dealer.lat, dealer.lon) < 0.2,
    );
    if (!duplicate) kept.push(dealer);
    if (kept.length >= 40) break;
  }
  return kept;
}

function cachePath(key: string): string {
  return path.join(dataDir(), "dealers", `${key}.json`);
}

async function queryMirror(query: string): Promise<OverpassElement[]> {
  let lastError = "Dealer search is busy";
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
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      return payload.elements ?? [];
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Dealer search failed";
      console.error("[hailmap] dealers", mirror, lastError);
    }
  }
  throw new Error(`Dealer search failed (${lastError}). Try again in a moment.`);
}

export async function findDealers(input: {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  near?: { lat: number; lon: number } | null;
}): Promise<{ dealers: DealerPin[]; note: string | null }> {
  const bounds = geometryBounds(input.geometry);
  if (!bounds) throw new Error("That area has no outline");
  const span = ringSpanKm([
    [bounds.west, bounds.south],
    [bounds.east, bounds.north],
  ]);
  if (span > 500) throw new Error("Zoom in or pick a smaller hail swath (under about 300 miles).");
  const near = input.near && Number.isFinite(input.near.lat) ? input.near : {
    lat: (bounds.south + bounds.north) / 2,
    lon: (bounds.west + bounds.east) / 2,
  };
  const key = createHash("sha1")
    .update(JSON.stringify([bounds.west.toFixed(3), bounds.south.toFixed(3), bounds.east.toFixed(3), bounds.north.toFixed(3)]))
    .digest("hex")
    .slice(0, 20);
  const file = cachePath(key);
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8")) as { at: number; elements: OverpassElement[] };
      if (Date.now() - cached.at < 12 * 3600 * 1000 && Array.isArray(cached.elements)) {
        return {
          dealers: dealersFromElements(cached.elements, input.geometry, near),
          note: "Car dealerships and named auto lots from OpenStreetMap.",
        };
      }
    } catch {
      /* refetch */
    }
  }
  const elements = await queryMirror(overpassQuery(bounds));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ at: Date.now(), elements }));
  const dealers = dealersFromElements(elements, input.geometry, near);
  return {
    dealers,
    note: dealers.length
      ? "Car dealerships and named auto lots from OpenStreetMap."
      : "No mapped dealerships in this swath. OpenStreetMap does not list every lot.",
  };
}
