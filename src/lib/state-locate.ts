import { pointInGeometry } from "@/lib/geo";
import states from "@/data/us-states.json";

interface StateFeature {
  properties?: { abbr?: string; name?: string; kind?: string };
  geometry?: GeoJSON.Geometry;
}

interface PreparedState {
  abbr: string;
  name: string;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  west: number;
  south: number;
  east: number;
  north: number;
  label: { lon: number; lat: number } | null;
}

let prepared: PreparedState[] | null = null;

function walk(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon, visit: (lon: number, lat: number) => void) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const pair of ring) {
        if (pair.length >= 2) visit(Number(pair[0]), Number(pair[1]));
      }
    }
  }
}

function loadStates(): PreparedState[] {
  if (prepared) return prepared;
  const features = (states as { features?: StateFeature[] }).features ?? [];
  const byAbbr = new Map<string, PreparedState>();
  for (const feature of features) {
    const abbr = feature.properties?.abbr?.trim().toUpperCase();
    const geometry = feature.geometry;
    if (!abbr || !geometry) continue;
    const current = byAbbr.get(abbr) ?? {
      abbr,
      name: feature.properties?.name?.trim() || abbr,
      geometry: { type: "Polygon", coordinates: [] },
      west: Infinity,
      south: Infinity,
      east: -Infinity,
      north: -Infinity,
      label: null,
    };
    if (feature.properties?.name) current.name = feature.properties.name;
    if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
      current.label = { lon: Number(geometry.coordinates[0]), lat: Number(geometry.coordinates[1]) };
    } else if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      current.geometry = geometry;
      walk(geometry, (lon, lat) => {
        current.west = Math.min(current.west, lon);
        current.east = Math.max(current.east, lon);
        current.south = Math.min(current.south, lat);
        current.north = Math.max(current.north, lat);
      });
    }
    byAbbr.set(abbr, current);
  }
  prepared = [...byAbbr.values()].filter((item) => item.geometry.coordinates.length > 0);
  return prepared;
}

export function stateOf(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const state of loadStates()) {
    if (lon < state.west || lon > state.east || lat < state.south || lat > state.north) continue;
    if (pointInGeometry(lon, lat, state.geometry)) return state.abbr;
  }
  return null;
}

export function stateLabel(abbr: string): string {
  return loadStates().find((item) => item.abbr === abbr.toUpperCase())?.name ?? abbr.toUpperCase();
}

/** True when a hail polygon overlaps a state, including a polygon that contains the whole state. */
export function intersectsState(code: string, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const state = loadStates().find((item) => item.abbr === code.toUpperCase());
  if (!state) return false;
  if (state.label && pointInGeometry(state.label.lon, state.label.lat, geometry)) return true;
  const vertices: Array<[number, number]> = [];
  walk(geometry, (lon, lat) => vertices.push([lon, lat]));
  const step = Math.max(1, Math.ceil(vertices.length / 180));
  for (let index = 0; index < vertices.length; index += step) {
    const [lon, lat] = vertices[index];
    if (lon < state.west || lon > state.east || lat < state.south || lat > state.north) continue;
    if (pointInGeometry(lon, lat, state.geometry)) return true;
  }
  return false;
}
