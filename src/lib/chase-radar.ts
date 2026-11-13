/** One coarse MESH bin from the history index. latQ and lonQ are degrees times 10. */
export interface RadarCell {
  stormDate: string;
  latQ: number;
  lonQ: number;
  maxIn: number;
}

interface RadarHit {
  stormDate: string;
  lat: number;
  lon: number;
  radarIn: number | null;
}

/** Neighborhood, in 0.1° bins, around a spotter. About 30 km, the size of a chase area. */
const RADAR_BINS = 3;
const RADAR_MIN_IN = 0.75;

/**
 * Attach radar hail that fell next to a spotter. Spotter reports do not carry MESH,
 * and the chase list was printing a dash whenever that lookup missed.
 */
export function stampChaseRadar<T extends RadarHit>(hits: T[], cells: RadarCell[]): T[] {
  const mesh = new Map<string, number>();
  for (const cell of cells) {
    if (!(cell.maxIn >= 0.5)) continue;
    const key = `${cell.stormDate}|${cell.latQ}|${cell.lonQ}`;
    const prev = mesh.get(key) ?? 0;
    if (cell.maxIn > prev) mesh.set(key, cell.maxIn);
  }
  return hits.map((hit) => {
    const latQ = Math.round(hit.lat * 10);
    const lonQ = Math.round(hit.lon * 10);
    let max = hit.radarIn ?? 0;
    for (let dy = -RADAR_BINS; dy <= RADAR_BINS; dy += 1) {
      for (let dx = -RADAR_BINS; dx <= RADAR_BINS; dx += 1) {
        max = Math.max(max, mesh.get(`${hit.stormDate}|${latQ + dy}|${lonQ + dx}`) ?? 0);
      }
    }
    if (max >= RADAR_MIN_IN) return { ...hit, radarIn: Math.round(max * 100) / 100 };
    return hit;
  });
}
