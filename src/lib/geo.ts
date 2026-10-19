export function validLatLon(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Xy {
  x: number;
  y: number;
}

export function project(lon: number, lat: number, originLon: number, originLat: number): Xy {
  const kx = 111.32 * Math.cos((originLat * Math.PI) / 180);
  const ky = 110.574;
  return { x: (lon - originLon) * kx, y: (lat - originLat) * ky };
}

export function unproject(x: number, y: number, originLon: number, originLat: number): { lon: number; lat: number } {
  const kx = 111.32 * Math.cos((originLat * Math.PI) / 180);
  const ky = 110.574;
  return { lon: originLon + x / kx, lat: originLat + y / ky };
}

export interface LngLatBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Padded bounds for framing a set of reports. Single points stay a small area. */
export function boundsOf(
  points: Array<{ lon: number; lat: number }>,
  padDegrees = 0.4,
): LngLatBounds | null {
  const valid = points.filter((point) => validLatLon(point.lat, point.lon));
  if (!valid.length) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of valid) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const latPad = Math.max(padDegrees, (north - south) * 0.2);
  const lonPad = Math.max(padDegrees, (east - west) * 0.2);
  return {
    west: Math.max(-180, west - lonPad),
    south: Math.max(-90, south - latPad),
    east: Math.min(180, east + lonPad),
    north: Math.min(90, north + latPad),
  };
}

const MAP_LAT_LIMIT = 85;

/** Longitude in [-180, 180]. Values from another world copy land on the same meridian. */
export function wrapLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return NaN;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * A view MapLibre can actually draw and the history API can query.
 * Phone cameras zoomed past the world, or panned onto another copy, report
 * longitudes outside [-180, 180]. Those get folded back in. A lat/lng pair
 * that was stored backwards is swapped. Anything non-finite is rejected.
 */
export function normalizeMapBounds(
  input: { west: number; south: number; east: number; north: number } | null | undefined,
): LngLatBounds | null {
  if (!input) return null;
  let { west, south, east, north } = input;
  if (![west, south, east, north].every((value) => Number.isFinite(value))) return null;
  const latitudesLookLikeLongitudes = (Math.abs(south) > 90 || Math.abs(north) > 90) && Math.abs(west) <= 90 && Math.abs(east) <= 90;
  if (latitudesLookLikeLongitudes) {
    const latWest = west;
    const latEast = east;
    west = Math.min(south, north);
    east = Math.max(south, north);
    south = Math.min(latWest, latEast);
    north = Math.max(latWest, latEast);
  }
  south = Math.min(MAP_LAT_LIMIT, Math.max(-MAP_LAT_LIMIT, south));
  north = Math.min(MAP_LAT_LIMIT, Math.max(-MAP_LAT_LIMIT, north));
  if (south > north) [south, north] = [north, south];
  if (north - south < 1e-4) {
    south = Math.max(-MAP_LAT_LIMIT, south - 0.05);
    north = Math.min(MAP_LAT_LIMIT, north + 0.05);
  }
  if (east < west) east += 360;
  const span = east - west;
  if (!(span > 0)) return null;
  if (span >= 360) return { west: -180, south, east: 180, north };
  const center = wrapLongitude((west + east) / 2);
  let wrappedWest = center - span / 2;
  let wrappedEast = center + span / 2;
  if (wrappedWest < -180) {
    wrappedWest = -180;
    wrappedEast = Math.min(180, -180 + span);
  }
  if (wrappedEast > 180) {
    wrappedEast = 180;
    wrappedWest = Math.max(-180, 180 - span);
  }
  if (!(wrappedEast > wrappedWest)) return { west: -180, south, east: 180, north };
  return { west: wrappedWest, south, east: wrappedEast, north };
}

/** Bounds failures stay off the screen as raw parser text. */
export function mapBoundsMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  if (/outside the world|map bounds are empty|map bounds are not usable|west, south, east, and north are required/i.test(message)) {
    return "Zoom in a little to load storms for this view.";
  }
  return message;
}

/** Rough diagonal span of a lon/lat ring, in kilometres. */
export function ringSpanKm(ring: Array<[number, number]>): number {
  if (ring.length === 0) return 0;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return haversineKm(minLat, minLon, maxLat, maxLon);
}

function ringContains(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lon: number, lat: number, coordinates: number[][][]): boolean {
  const [outer, ...holes] = coordinates;
  if (!outer || !ringContains(lon, lat, outer)) return false;
  return !holes.some((hole) => ringContains(lon, lat, hole));
}

/** True when lon/lat falls inside a Polygon or MultiPolygon, respecting holes. */
export function pointInGeometry(lon: number, lat: number, geometry: GeoJSON.Geometry | null | undefined): boolean {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInPolygon(lon, lat, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => pointInPolygon(lon, lat, polygon));
  return false;
}
