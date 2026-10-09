import { pointInGeometry } from "@/lib/geo";
import { levelForScore, scoreDamage, type DamageLevel, type ScoreReport } from "@/lib/probability";

const FILL: Record<DamageLevel, string> = {
  Low: "#86efac",
  Moderate: "#facc15",
  High: "#fb923c",
  "Very High": "#f43f5e",
};

export interface HeatOptions {
  cellDegrees?: number;
  radiusKm?: number;
  now?: number;
  maxCells?: number;
  swaths?: GeoJSON.FeatureCollection | null;
}

/** Coarse area grid scored with the same model as an address. Cells with no signal are omitted. */
export function damageHeatGrid(reports: ScoreReport[], options: HeatOptions = {}): GeoJSON.FeatureCollection {
  const cell = options.cellDegrees ?? 0.4;
  const radiusKm = options.radiusKm ?? 25;
  const buckets = new Map<string, { x: number; y: number; count: number }>();
  for (const report of reports) {
    if (!Number.isFinite(report.lat) || !Number.isFinite(report.lon)) continue;
    const x = Math.floor(report.lon / cell);
    const y = Math.floor(report.lat / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const key = `${x + dx}:${y + dy}`;
        const row = buckets.get(key);
        const bump = dx === 0 && dy === 0 ? 1 : 0;
        if (row) row.count += bump;
        else buckets.set(key, { x: x + dx, y: y + dy, count: bump });
      }
    }
  }

  const ranked = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, options.maxCells ?? 400);
  const features: GeoJSON.Feature[] = [];
  for (const bucket of ranked) {
    const west = bucket.x * cell;
    const south = bucket.y * cell;
    const east = west + cell;
    const north = south + cell;
    const lat = (south + north) / 2;
    const lon = (west + east) / 2;
    let swathHit = false;
    let maxSizeIn: number | null = null;
    for (const feature of options.swaths?.features ?? []) {
      if (!pointInGeometry(lon, lat, feature.geometry)) continue;
      swathHit = true;
      const size = feature.properties?.maxSizeIn;
      if (typeof size === "number") maxSizeIn = maxSizeIn == null ? size : Math.max(maxSizeIn, size);
    }
    const scored = scoreDamage({
      lat,
      lon,
      radiusKm,
      now: options.now,
      reports,
      swath: swathHit ? { hit: true, maxSizeIn } : null,
    });
    if (scored.score <= 0 && bucket.count === 0) continue;
    const level = levelForScore(scored.score);
    features.push({
      type: "Feature",
      properties: {
        score: scored.score,
        level,
        fill: FILL[level],
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}
