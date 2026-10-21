import { haversineKm, pointInGeometry, ringSpanKm } from "@/lib/geo";

export type KnockMode = "walk" | "drive";

export interface KnockStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  hailIn: number;
}

export interface HailBand {
  minIn: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

/** Google Maps directions accepts 9 stops between the start and the end. */
export const GOOGLE_WAYPOINTS = 9;

/** Apple Maps `daddr` `+to:` chains stay reliable around 12 intermediate stops. */
export const APPLE_INTERMEDIATE = 12;

const RESIDENTIAL = new Set(["residential", "living_street", "unclassified"]);

export interface StreetWay {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat?: number; lon?: number }>;
}

export function circlePolygon(lat: number, lon: number, radiusKm: number, steps = 16): GeoJSON.Polygon {
  const ring: number[][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const dLat = (radiusKm / 110.574) * Math.cos(angle);
    const dLon = (radiusKm / (111.32 * Math.cos(latRad))) * Math.sin(angle);
    ring.push([lon + dLon, lat + dLat]);
  }
  return { type: "Polygon", coordinates: [ring] };
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

/** A county-sized swath is not a walking loop. Keep the streets around the selected point. */
export function knockWorkGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  focus: { lat: number; lon: number },
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const bounds = geometryBounds(geometry);
  if (!bounds) return geometry;
  const span = ringSpanKm([
    [bounds.west, bounds.south],
    [bounds.east, bounds.north],
  ]);
  if (span <= 8) return geometry;
  return circlePolygon(focus.lat, focus.lon, 2.4);
}

export function hailAt(lon: number, lat: number, bands: HailBand[], fallback: number): number {
  let best = 0;
  for (const band of bands) {
    if (!Number.isFinite(band.minIn) || band.minIn <= best) continue;
    if (pointInGeometry(lon, lat, band.geometry)) best = band.minIn;
  }
  if (best > 0) return Math.round(Math.min(8, best) * 100) / 100;
  const n = Number(fallback);
  if (!Number.isFinite(n) || n <= 0) return 0.75;
  return Math.round(Math.min(8, n) * 100) / 100;
}

function midpoint(geometry: Array<{ lat?: number; lon?: number }>): { lat: number; lon: number } | null {
  const points = geometry.filter((pair) => Number.isFinite(pair.lat) && Number.isFinite(pair.lon)) as Array<{ lat: number; lon: number }>;
  if (points.length < 2) return null;
  const mid = points[Math.floor(points.length / 2)];
  return { lat: mid.lat, lon: mid.lon };
}

/**
 * One stop per street name. The hardest hail sample on that street wins.
 * The caller then walks those streets in nearest-neighbor order.
 */
export function streetsFromWays(
  elements: StreetWay[],
  area: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  bands: HailBand[],
  focus: { lat: number; lon: number },
  fallbackHail: number,
): KnockStop[] {
  const byName = new Map<string, KnockStop>();
  for (const element of elements) {
    const tags = element.tags ?? {};
    if (!RESIDENTIAL.has(tags.highway ?? "")) continue;
    const name = (tags.name || "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) continue;
    const point = midpoint(element.geometry ?? []);
    if (!point || !pointInGeometry(point.lon, point.lat, area)) continue;
    const hailIn = hailAt(point.lon, point.lat, bands, fallbackHail);
    const key = name.toLowerCase();
    const stop: KnockStop = {
      id: `${element.type ?? "way"}/${element.id ?? key}`,
      name,
      lat: point.lat,
      lon: point.lon,
      hailIn,
    };
    const prev = byName.get(key);
    const closer =
      !prev ||
      stop.hailIn > prev.hailIn + 0.001 ||
      (Math.abs(stop.hailIn - prev.hailIn) <= 0.001 &&
        haversineKm(focus.lat, focus.lon, stop.lat, stop.lon) < haversineKm(focus.lat, focus.lon, prev.lat, prev.lon));
    if (closer) byName.set(key, stop);
  }
  return [...byName.values()]
    .sort((a, b) => b.hailIn - a.hailIn || a.name.localeCompare(b.name))
    .slice(0, 16);
}

/** Start at the hard-hit street nearest the selection, then always take the closest remaining street. */
export function orderKnockStops(stops: KnockStop[], focus: { lat: number; lon: number }): KnockStop[] {
  const pool = stops.slice();
  if (pool.length < 2) return pool;
  pool.sort(
    (a, b) =>
      haversineKm(focus.lat, focus.lon, a.lat, a.lon) - haversineKm(focus.lat, focus.lon, b.lat, b.lon) ||
      b.hailIn - a.hailIn,
  );
  const ordered: KnockStop[] = [pool.shift() as KnockStop];
  while (pool.length) {
    const last = ordered[ordered.length - 1];
    let best = 0;
    let bestKm = Infinity;
    pool.forEach((stop, index) => {
      const km = haversineKm(last.lat, last.lon, stop.lat, stop.lon);
      if (km < bestKm - 0.0001 || (Math.abs(km - bestKm) <= 0.0001 && stop.hailIn > pool[best].hailIn)) {
        bestKm = km;
        best = index;
      }
    });
    ordered.push(pool.splice(best, 1)[0]);
  }
  return ordered;
}

function coord(stop: KnockStop): string {
  return `${stop.lat.toFixed(5)},${stop.lon.toFixed(5)}`;
}

export function googleMapsHref(stops: KnockStop[], mode: KnockMode): { url: string; count: number } {
  if (!stops.length) return { url: "", count: 0 };
  if (stops.length === 1) {
    return { url: `https://www.google.com/maps/search/?api=1&query=${coord(stops[0])}`, count: 1 };
  }
  const used = stops.slice(0, GOOGLE_WAYPOINTS + 2);
  const waypoints = used.slice(1, -1).map(coord);
  const travel = mode === "drive" ? "driving" : "walking";
  const params = new URLSearchParams({
    api: "1",
    origin: coord(used[0]),
    destination: coord(used[used.length - 1]),
    travelmode: travel,
  });
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return { url: `https://www.google.com/maps/dir/?${params.toString()}`, count: used.length };
}

export function appleMapsHref(stops: KnockStop[], mode: KnockMode): { url: string; count: number } {
  if (!stops.length) return { url: "", count: 0 };
  if (stops.length === 1) {
    return {
      url: `https://maps.apple.com/?ll=${coord(stops[0])}&q=${encodeURIComponent(stops[0].name)}`,
      count: 1,
    };
  }
  const used = stops.slice(0, APPLE_INTERMEDIATE + 2);
  const daddr = used
    .slice(1)
    .map(coord)
    .join("+to:");
  const dir = mode === "drive" ? "d" : "w";
  return {
    url: `https://maps.apple.com/?saddr=${coord(used[0])}&daddr=${daddr}&dirflg=${dir}`,
    count: used.length,
  };
}

export function routeLine(stops: KnockStop[]): GeoJSON.FeatureCollection {
  if (stops.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "knock" },
        geometry: {
          type: "LineString",
          coordinates: stops.map((stop) => [stop.lon, stop.lat]),
        },
      },
    ],
  };
}

function simplifyRing(ring: number[][]): number[][] {
  const step = Math.max(1, Math.ceil(ring.length / 48));
  const next = ring.filter((_, index) => index % step === 0).slice(0, 48);
  const first = next[0];
  const last = next[next.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) next.push(first);
  return next.length >= 4 ? next : [];
}

/** Keep only hail bands near the stop so the route request stays small. */
export function compactBands(
  features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }>,
  focus: { lat: number; lon: number },
): HailBand[] {
  const bands: HailBand[] = [];
  for (const feature of features) {
    const minIn = Number(feature.properties?.minIn);
    const geometry = feature.geometry;
    if (!Number.isFinite(minIn) || minIn <= 0 || minIn > 8) continue;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const bounds = geometryBounds(geometry);
    if (!bounds) continue;
    if (focus.lon < bounds.west - 0.08 || focus.lon > bounds.east + 0.08) continue;
    if (focus.lat < bounds.south - 0.08 || focus.lat > bounds.north + 0.08) continue;
    const simplified =
      geometry.type === "Polygon"
        ? { type: "Polygon" as const, coordinates: geometry.coordinates.slice(0, 1).map(simplifyRing).filter((ring) => ring.length >= 4) }
        : {
            type: "MultiPolygon" as const,
            coordinates: geometry.coordinates
              .slice(0, 2)
              .map((polygon) => polygon.slice(0, 1).map(simplifyRing).filter((ring) => ring.length >= 4))
              .filter((polygon) => polygon.length),
          };
    if (!simplified.coordinates.length) continue;
    bands.push({ minIn: Math.round(minIn * 100) / 100, geometry: simplified });
    if (bands.length >= 6) break;
  }
  bands.sort((a, b) => b.minIn - a.minIn);
  return bands.slice(0, 6);
}
