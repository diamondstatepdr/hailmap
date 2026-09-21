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
