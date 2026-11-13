import { haversineKm } from "@/lib/geo";
import { MIN_HAIL_IN, type HoneyBounds } from "@/lib/honey";
import type { ChaseHit } from "@/lib/chase-week";

const HAIL_FRAME_MIN = 0.12;
const HAIL_FRAME_MAX = 0.2;

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * Where a chase row should open the map. Radar size is often copied from a MESH
 * bin a few miles from the spotter, so the camera has to use that bin or the
 * swath sits off-screen.
 */
export function hailAim(hits: ChaseHit[]): { lat: number; lon: number; bounds: HoneyBounds } | null {
  let peak: ChaseHit | null = null;
  let peakSize = -1;
  for (const hit of hits) {
    const size = Math.max(hit.radarIn ?? 0, hit.spotterIn ?? 0);
    if (size > peakSize) {
      peak = hit;
      peakSize = size;
    }
  }
  if (!peak || peakSize < MIN_HAIL_IN) return null;
  let lat = peak.lat;
  let lon = peak.lon;
  if (
    peak.radarLat != null &&
    peak.radarLon != null &&
    (peak.radarIn ?? 0) >= MIN_HAIL_IN &&
    (peak.radarIn ?? 0) >= (peak.spotterIn ?? 0)
  ) {
    lat = peak.radarLat;
    lon = peak.radarLon;
  }
  const points = [{ lat, lon }];
  for (const hit of hits) {
    if (haversineKm(lat, lon, hit.lat, hit.lon) <= 12) points.push({ lat: hit.lat, lon: hit.lon });
    if (hit.radarLat != null && hit.radarLon != null && haversineKm(lat, lon, hit.radarLat, hit.radarLon) <= 12) {
      points.push({ lat: hit.radarLat, lon: hit.radarLon });
    }
  }
  let west = lon;
  let east = lon;
  let south = lat;
  let north = lat;
  for (const point of points) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const midLat = (south + north) / 2;
  const midLon = (west + east) / 2;
  const halfLat = Math.min(HAIL_FRAME_MAX, Math.max(HAIL_FRAME_MIN, (north - south) / 2 + 0.02));
  const halfLon = Math.min(HAIL_FRAME_MAX, Math.max(HAIL_FRAME_MIN, (east - west) / 2 + 0.02));
  return {
    lat,
    lon,
    bounds: {
      west: round4(midLon - halfLon),
      east: round4(midLon + halfLon),
      south: round4(midLat - halfLat),
      north: round4(midLat + halfLat),
    },
  };
}

/** Keep a landing frame on the hail. A metro-wide cluster box hides a small swath. */
export function frameChaseStop(stop: { lat: number; lon: number; bounds: HoneyBounds }): HoneyBounds {
  const half = HAIL_FRAME_MIN;
  return {
    west: round4(stop.lon - half),
    east: round4(stop.lon + half),
    south: round4(stop.lat - half),
    north: round4(stop.lat + half),
  };
}
