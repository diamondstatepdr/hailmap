import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { pointInGeometry } from "@/lib/geo";
import { userAgent } from "@/lib/ingest";
import {
  geometryBounds,
  knockWorkGeometry,
  orderKnockStops,
  streetsFromWays,
  type HailBand,
  type KnockStop,
  type StreetWay,
} from "@/lib/knock-route";

const MIRRORS = [
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function overpassQuery(bounds: { west: number; south: number; east: number; north: number }): string {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:12];
way["highway"~"^(residential|living_street|unclassified)$"]["name"](${box});
out geom 100;`;
}

async function queryMirror(query: string): Promise<StreetWay[]> {
  let lastError = "Street search is busy";
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
        signal: AbortSignal.timeout(12000),
        cache: "no-store",
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const payload = (await response.json()) as { elements?: StreetWay[] };
      return payload.elements ?? [];
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Street search failed";
      console.error("[hailmap] knock-route", mirror, lastError);
    }
  }
  throw new Error(`Street search failed (${lastError}). Try again in a moment.`);
}

export async function findKnockRoute(input: {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  focus: { lat: number; lon: number };
  bands: HailBand[];
  fallbackHail: number;
}): Promise<{ stops: KnockStop[]; note: string }> {
  const work = knockWorkGeometry(input.geometry, input.focus);
  const bounds = geometryBounds(work);
  if (!bounds) throw new Error("That area has no outline");
  const key = createHash("sha1")
    .update(JSON.stringify([bounds.west.toFixed(3), bounds.south.toFixed(3), bounds.east.toFixed(3), bounds.north.toFixed(3)]))
    .digest("hex")
    .slice(0, 20);
  const file = path.join(dataDir(), "knock-routes", `${key}.json`);
  let elements: StreetWay[] | null = null;
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, "utf8")) as { at: number; elements: StreetWay[] };
      if (Date.now() - cached.at < 12 * 3600 * 1000 && Array.isArray(cached.elements)) elements = cached.elements;
    } catch {
      elements = null;
    }
  }
  if (!elements) {
    elements = await queryMirror(overpassQuery(bounds));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), elements }));
  }
  const ranked = streetsFromWays(elements, input.geometry, input.bands, input.focus, input.fallbackHail).filter((stop) =>
    pointInGeometry(stop.lon, stop.lat, work),
  );
  const stops = orderKnockStops(ranked, input.focus);
  const shrunk = work !== input.geometry;
  return {
    stops,
    note: stops.length
      ? `Named residential streets from OpenStreetMap${shrunk ? ", in the part of this swath around your selection" : ""}. Hardest hail first, then ordered into one route.`
      : "No named residential streets in this area. OpenStreetMap does not list every block.",
  };
}
