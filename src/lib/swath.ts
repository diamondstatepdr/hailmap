import { confidenceRank, type Confidence } from "@/lib/confidence";
import { haversineKm, project, unproject, validLatLon, type Xy } from "@/lib/geo";
import { MESH_LEGEND } from "@/lib/mesh-legend";
import { separateBandFills } from "@/lib/swath-bands";

export const SWATH_RADIUS_KM = 45;
export const SWATH_WINDOW_HOURS = 3;
export const SWATH_BUFFER_KM = 8;

export interface SwathPoint {
  id?: string;
  lat: number;
  lon: number;
  occurredAt: string;
  sizeIn?: number | null;
  confidence?: Confidence;
}

export interface SwathOptions {
  radiusKm?: number;
  windowHours?: number;
  bufferKm?: number;
}

function cross(origin: Xy, a: Xy, b: Xy): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

export function convexHullXY(points: Xy[]): Xy[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const unique: Xy[] = [];
  for (const point of sorted) {
    const last = unique[unique.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) unique.push(point);
  }
  if (unique.length <= 2) return unique;

  const lower: Xy[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: Xy[] = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function convexHull(points: Array<{ lon: number; lat: number }>): Array<{ lon: number; lat: number }> {
  if (points.length === 0) return [];
  const originLon = points.reduce((sum, point) => sum + point.lon, 0) / points.length;
  const originLat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const local = points.map((point) => ({
    ...project(point.lon, point.lat, originLon, originLat),
    lon: point.lon,
    lat: point.lat,
  }));
  const hull = convexHullXY(local);
  return hull.map((point) => {
    const match = local.find((item) => item.x === point.x && item.y === point.y);
    return match ? { lon: match.lon, lat: match.lat } : unproject(point.x, point.y, originLon, originLat);
  });
}

function circleSamples(center: Xy, radiusKm: number, count = 12): Xy[] {
  const samples: Xy[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    samples.push({
      x: center.x + radiusKm * Math.cos(angle),
      y: center.y + radiusKm * Math.sin(angle),
    });
  }
  return samples;
}

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

/** Buffer a point set. The buffer of a convex hull is the hull of circles at its vertices. */
export function bufferPoints(
  points: Array<{ lon: number; lat: number }>,
  bufferKm: number,
  origin?: { lon: number; lat: number },
): Array<{ lon: number; lat: number }> {
  if (points.length === 0 || bufferKm <= 0) return [];
  const originLon = origin?.lon ?? points.reduce((sum, point) => sum + point.lon, 0) / points.length;
  const originLat = origin?.lat ?? points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const local = points.map((point) => project(point.lon, point.lat, originLon, originLat));
  const hull = convexHullXY(local);
  const seeds = hull.length ? hull : local;
  const samples = seeds.flatMap((point) => circleSamples(point, bufferKm));
  const buffered = convexHullXY(samples);
  const ring = buffered.map((point) => {
    const geo = unproject(point.x, point.y, originLon, originLat);
    return { lon: round5(geo.lon), lat: round5(geo.lat) };
  });
  if (ring.length) ring.push({ ...ring[0] });
  return ring;
}

export function clusterBySpaceTime<T extends SwathPoint>(
  points: T[],
  radiusKm = SWATH_RADIUS_KM,
  windowHours = SWATH_WINDOW_HOURS,
): T[][] {
  const usable = points.filter(
    (point) => validLatLon(point.lat, point.lon) && !Number.isNaN(Date.parse(point.occurredAt)),
  );
  const parent = usable.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  const times = usable.map((point) => Date.parse(point.occurredAt));
  const windowMs = windowHours * 3600 * 1000;
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (Math.abs(times[i] - times[j]) > windowMs) continue;
      if (haversineKm(usable[i].lat, usable[i].lon, usable[j].lat, usable[j].lon) <= radiusKm) {
        union(i, j);
      }
    }
  }
  const groups = new Map<number, T[]>();
  for (let i = 0; i < usable.length; i += 1) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(usable[i]);
    else groups.set(root, [usable[i]]);
  }
  return [...groups.values()];
}

function bestConfidence(points: SwathPoint[]): Confidence {
  let best: Confidence = "community";
  for (const point of points) {
    const confidence = point.confidence ?? "community";
    if (confidenceRank(confidence) > confidenceRank(best)) best = confidence;
  }
  return best;
}

export function reportsToSwaths(reports: SwathPoint[], options: SwathOptions = {}): GeoJSON.FeatureCollection {
  const radiusKm = options.radiusKm ?? SWATH_RADIUS_KM;
  const windowHours = options.windowHours ?? SWATH_WINDOW_HOURS;
  const bufferKm = options.bufferKm ?? SWATH_BUFFER_KM;
  const clusters = clusterBySpaceTime(reports, radiusKm, windowHours);
  const features: GeoJSON.Feature[] = [];

  clusters.forEach((cluster, index) => {
    const timed = [...cluster].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const times = timed.map((point) => Date.parse(point.occurredAt));
    const startedAt = new Date(times[0]).toISOString();
    const endedAt = new Date(times[times.length - 1]).toISOString();
    const first = timed[0];
    const last = timed[timed.length - 1];
    const motion = {
      startLat: first.lat,
      startLon: first.lon,
      endLat: last.lat,
      endLon: last.lon,
    };
    const confidence = bestConfidence(cluster);
    const sized = cluster.filter((point) => point.sizeIn != null && point.sizeIn >= MESH_LEGEND[0].minIn);
    if (!sized.length) {
      const ring = bufferPoints(
        cluster.map((point) => ({ lon: point.lon, lat: point.lat })),
        bufferKm,
      );
      if (ring.length < 4) return;
      features.push({
        type: "Feature",
        id: `swath-${index}`,
        geometry: {
          type: "Polygon",
          coordinates: [ring.map((point) => [point.lon, point.lat])],
        },
        properties: {
          count: cluster.length,
          maxSizeIn: null,
          minIn: null,
          label: null,
          color: "#64748b",
          ink: "#ffffff",
          halo: true,
          showLabel: false,
          startedAt,
          endedAt,
          ...motion,
          confidence,
        },
      });
      features.push({
        type: "Feature",
        properties: { halo: true, kind: "edge", color: "#64748b" },
        geometry: { type: "LineString", coordinates: ring.map((point) => [point.lon, point.lat]) },
      });
      return;
    }
    const batch: GeoJSON.Feature[] = [];
    const origin = {
      lon: sized.reduce((sum, point) => sum + point.lon, 0) / sized.length,
      lat: sized.reduce((sum, point) => sum + point.lat, 0) / sized.length,
    };
    let pending: { key: string; band: (typeof MESH_LEGEND)[number]; points: SwathPoint[] } | null = null;
    const emit = (row: { band: (typeof MESH_LEGEND)[number]; points: SwathPoint[] }) => {
      const ring = bufferPoints(
        row.points.map((point) => ({ lon: point.lon, lat: point.lat })),
        bufferKm,
        origin,
      );
      if (ring.length < 4) return;
      const maxSizeIn = Math.max(...row.points.map((point) => point.sizeIn ?? row.band.minIn));
      batch.push({
        type: "Feature",
        id: `swath-${index}-${row.band.minIn}`,
        geometry: {
          type: "Polygon",
          coordinates: [ring.map((point) => [point.lon, point.lat])],
        },
        properties: {
          count: row.points.length,
          maxSizeIn,
          minIn: row.band.minIn,
          label: row.band.label,
          mapLabel: row.band.mapLabel,
          color: row.band.color,
          ink: row.band.ink,
          startedAt,
          endedAt,
          ...motion,
          confidence,
        },
      });
    };
    for (const band of MESH_LEGEND) {
      const points = sized.filter((point) => (point.sizeIn ?? 0) >= band.minIn);
      if (!points.length) continue;
      const key = points
        .map((point) => `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`)
        .sort()
        .join("|");
      if (pending && pending.key === key) {
        pending.band = band;
        pending.points = points;
        continue;
      }
      if (pending) emit(pending);
      pending = { key, band, points };
    }
    if (pending) emit(pending);
    features.push(...separateBandFills(batch));
  });

  return { type: "FeatureCollection", features };
}
