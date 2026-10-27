import { readFileSync } from "node:fs";
import path from "node:path";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { ChaseHit } from "@/lib/chase-week";
import { pointInGeometry } from "@/lib/geo";
import { repairPlaceName } from "@/lib/place-name";
import { stateLabel, stateOf } from "@/lib/state-locate";

interface CountyShape {
  name: string;
  west: number;
  south: number;
  east: number;
  north: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

let counties: CountyShape[] | null = null;

function boundsOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { west: number; south: number; east: number; north: number } {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const pair of ring) {
        const lon = Number(pair[0]);
        const lat = Number(pair[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
  }
  return { west, south, east, north };
}

function loadCounties(): CountyShape[] {
  if (counties) return counties;
  const file = path.join(process.cwd(), "data", "census", "counties-10m.json");
  const topo = JSON.parse(readFileSync(file, "utf8")) as Topology;
  const collection = feature(topo, topo.objects.counties as GeometryCollection) as unknown as GeoJSON.FeatureCollection;
  counties = [];
  for (const item of collection.features) {
    const name = String((item.properties as { name?: string } | null)?.name ?? "").trim();
    const geometry = item.geometry;
    if (!name || !geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const bounds = boundsOf(geometry);
    if (!Number.isFinite(bounds.west)) continue;
    counties.push({ name, ...bounds, geometry });
  }
  return counties;
}

/** County name from the bundled census map. Null outside those counties. */
export function countyNameAt(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const county of loadCounties()) {
    if (lon < county.west || lon > county.east || lat < county.south || lat > county.north) continue;
    if (pointInGeometry(lon, lat, county.geometry)) return county.name;
  }
  return null;
}

function knownState(value: string | null | undefined): string | null {
  const abbr = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(abbr)) return null;
  return stateLabel(abbr) === abbr ? null : abbr;
}

const OFFSET = /^\d+(?:\.\d+)?\s+(?:NNE|NNW|SSE|SSW|ENE|ESE|WNW|WSW|NE|NW|SE|SW|N|S|E|W)\s+(.+)$/i;
const DIRECTIONAL_DIVISION = /^(?:north|south|east|west|northeast|northwest|southeast|southwest|central)\b|\b(?:north|south|east|west|northeast|northwest|southeast|southwest)$/i;
const NOT_A_TOWN = /\b(?:county|parish|borough|census area|precinct|district|unorganized|gore|ccd)\b/i;

/** Town name from a spotter string. "4 SW Crowell" becomes "Crowell". */
export function townFromLocation(location: string | null | undefined): string | null {
  const text = location?.replace(/\s+/g, " ").trim() ?? "";
  if (!text || text.includes(";") || text.length > 48) return null;
  const offset = text.match(OFFSET);
  let town = (offset?.[1] ?? text).replace(/^town of\s+/i, "").trim();
  const comma = town.indexOf(",");
  if (comma > 0) town = town.slice(0, comma).trim();
  town = town.replace(/\s+(?:city|town|village|cdp)$/i, "").trim();
  if (!town || town.length > 40 || NOT_A_TOWN.test(town)) return null;
  return repairPlaceName(town);
}

/** Census county-division names such as "West Terrell" are not towns. */
export function isDirectionalDivision(name: string): boolean {
  return DIRECTIONAL_DIVISION.test(name.trim());
}

/**
 * Keep a hail hit only when it lands in a US state, and name radar-only
 * cells from the county they actually fall in.
 */
export function placeChaseHit(hit: ChaseHit): ChaseHit | null {
  const state = knownState(hit.state) ?? stateOf(hit.lat, hit.lon);
  if (!state) return null;
  const location = townFromLocation(hit.location);
  const next: ChaseHit = { ...hit, state, location };
  if (location) return next;
  const county = countyNameAt(next.lat, next.lon);
  if (county) next.county = county;
  return next;
}
