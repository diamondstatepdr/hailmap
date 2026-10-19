import type { Hazard } from "@/lib/hazard";

export interface ClusterInput {
  lat: number;
  lon: number;
  hazard: Hazard;
  sizeIn: number | null;
  windMph: number | null;
  efRating: string | null;
  efRank: number;
  occurredAt: string;
  stormDate: string;
  state?: string | null;
}

export interface ReportCluster {
  lat: number;
  lon: number;
  count: number;
  hailCount: number;
  windCount: number;
  tornadoCount: number;
  maxHailIn: number | null;
  maxWindMph: number | null;
  strongestTornado: string | null;
  stormDate: string;
  occurredAt: string;
  state?: string | null;
}

export function clusterCellDegrees(spanDeg: number): number {
  const across = 28;
  return Math.min(2, Math.max(0.18, spanDeg / across));
}

export function shouldCluster(count: number, spanDeg: number): boolean {
  if (count <= 900) return false;
  if (spanDeg >= 8 && count > 900) return true;
  return count > 2500;
}

/** Grid aggregation so a year of reports stays a few hundred dots. */
export function clusterReports(points: ClusterInput[], cellDeg: number): ReportCluster[] {
  const cell = Math.max(0.05, cellDeg);
  const groups = new Map<string, ClusterInput[]>();
  for (const point of points) {
    const gx = Math.floor(point.lon / cell);
    const gy = Math.floor(point.lat / cell);
    const key = `${gx}:${gy}`;
    const list = groups.get(key);
    if (list) list.push(point);
    else groups.set(key, [point]);
  }
  const clusters: ReportCluster[] = [];
  for (const group of groups.values()) {
    let hailCount = 0;
    let windCount = 0;
    let tornadoCount = 0;
    let maxHailIn: number | null = null;
    let maxWindMph: number | null = null;
    let strongest: ClusterInput | null = null;
    let newest = group[0];
    let lat = 0;
    let lon = 0;
    let state: string | null = null;
    let mixedState = false;
    for (const point of group) {
      lat += point.lat;
      lon += point.lon;
      if (point.hazard === "hail") {
        hailCount += 1;
        if (point.sizeIn != null) maxHailIn = maxHailIn == null ? point.sizeIn : Math.max(maxHailIn, point.sizeIn);
      } else if (point.hazard === "wind") {
        windCount += 1;
        if (point.windMph != null) maxWindMph = maxWindMph == null ? point.windMph : Math.max(maxWindMph, point.windMph);
      } else {
        tornadoCount += 1;
        if (!strongest || point.efRank > strongest.efRank) strongest = point;
      }
      if (point.occurredAt > newest.occurredAt) newest = point;
      const code = point.state?.trim().toUpperCase() || null;
      if (!mixedState) {
        if (!state) state = code;
        else if (code && code !== state) mixedState = true;
      }
    }
    clusters.push({
      lat: lat / group.length,
      lon: lon / group.length,
      count: group.length,
      hailCount,
      windCount,
      tornadoCount,
      maxHailIn,
      maxWindMph,
      strongestTornado: strongest?.efRating ?? null,
      stormDate: newest.stormDate,
      occurredAt: newest.occurredAt,
      state: mixedState ? null : state,
    });
  }
  clusters.sort((a, b) => (b.maxHailIn ?? -1) - (a.maxHailIn ?? -1) || b.count - a.count);
  return clusters;
}
