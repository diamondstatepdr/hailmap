import { haversineKm, project } from "@/lib/geo";

const KM_PER_MI = 1.609344;

export interface SwathStats {
  lengthMi: number;
  widthMi: number;
  areaSqMi: number;
  /** Bearing of the long axis, degrees clockwise from north. */
  axisDeg: number | null;
}

export interface SwathBandStats extends SwathStats {
  minIn: number;
  label: string;
}

export interface SwathMotion {
  /** "moving ENE" when the reports travel far enough to show a direction. */
  direction: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface SwathReadout {
  bands: SwathBandStats[];
  total: SwathStats;
  motion: SwathMotion;
  /** Highest inches that belongs to a band actually listed. */
  peakIn: number;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compassLabel(bearingDeg: number): string {
  const turn = ((bearingDeg % 360) + 360) % 360;
  return COMPASS[Math.round(turn / 22.5) % 16];
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function movingLabel(lat1: number, lon1: number, lat2: number, lon2: number): string | null {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  if (haversineKm(lat1, lon1, lat2, lon2) < 0.8) return null;
  return `moving ${compassLabel(bearingDeg(lat1, lon1, lat2, lon2))}`;
}

export function swathTitle(input: { source: "mesh" | "reports" | "view"; minIn: number | null; maxIn: number | null; label?: string }): string {
  const size = input.maxIn ?? input.minIn;
  const inches = size != null && Number.isFinite(size) ? `${size.toFixed(2)} in ` : "";
  if (input.source === "mesh") return `${inches}radar hail`.trim();
  if (input.source === "reports") return `${inches}report swath`.trim();
  return input.label?.trim() || "Map area";
}

export function formatMiles(miles: number): string {
  if (!Number.isFinite(miles) || miles <= 0) return "0 mi";
  if (miles >= 10) return `${Math.round(miles)} mi`;
  const tenths = Math.round(miles * 10) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)} mi`;
}

export function formatArea(sqMi: number): string {
  if (!Number.isFinite(sqMi) || sqMi <= 0) return "0 sq mi";
  if (sqMi >= 10) return `${Math.round(sqMi)} sq mi`;
  const tenths = Math.round(sqMi * 10) / 10;
  return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)} sq mi`;
}

export function statLine(stats: SwathStats): string {
  return `${formatMiles(stats.lengthMi)} long · ${formatMiles(stats.widthMi)} wide · ${formatArea(stats.areaSqMi)}`;
}

export function formatClockRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const opened = new Date(start);
  if (Number.isNaN(opened.getTime())) return null;
  const fmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const closed = end ? new Date(end) : null;
  if (!closed || Number.isNaN(closed.getTime()) || Math.abs(closed.getTime() - opened.getTime()) < 60_000) return fmt.format(opened);
  return `${fmt.format(opened)}–${fmt.format(closed)}`;
}

function bandOf(minIn: number): { minIn: number; label: string } {
  if (minIn >= 2.5) return { minIn: 2.5, label: '2.5"+' };
  if (minIn >= 2) return { minIn: 2, label: '2"' };
  if (minIn >= 1.5) return { minIn: 1.5, label: '1.5"' };
  if (minIn >= 1) return { minIn: 1, label: '1"' };
  if (minIn > 0) return { minIn: 0.75, label: '<1"' };
  return { minIn: 0, label: "Swath" };
}

function outerRings(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][] {
  if (geometry.type === "Polygon") return geometry.coordinates[0] ? [geometry.coordinates[0]] : [];
  return geometry.coordinates.map((polygon) => polygon[0]).filter((ring): ring is number[][] => Array.isArray(ring));
}

function polygonsOf(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number[][][][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

function ringPairs(ring: number[][]): Array<[number, number]> {
  const last = ring.length - 1;
  const open =
    ring.length > 1 && ring[0]?.[0] === ring[last]?.[0] && ring[0]?.[1] === ring[last]?.[1] ? ring.slice(0, -1) : ring;
  const pairs: Array<[number, number]> = [];
  for (const pair of open) {
    const lon = Number(pair?.[0]);
    const lat = Number(pair?.[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) pairs.push([lon, lat]);
  }
  return pairs;
}

function shoelaceSqKm(ring: Array<[number, number]>, originLon: number, originLat: number): number {
  if (ring.length < 3) return 0;
  const points = ring.map(([lon, lat]) => project(lon, lat, originLon, originLat));
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    sum += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(sum) / 2;
}

function axes(ring: Array<[number, number]>, originLon: number, originLat: number): { lengthKm: number; widthKm: number; axisDeg: number | null } {
  const points = ring.map(([lon, lat]) => project(lon, lat, originLon, originLat));
  if (points.length < 2) return { lengthKm: 0, widthKm: 0, axisDeg: null };
  let mx = 0;
  let my = 0;
  for (const point of points) {
    mx += point.x;
    my += point.y;
  }
  mx /= points.length;
  my /= points.length;
  let a = 0;
  let b = 0;
  let c = 0;
  for (const point of points) {
    const x = point.x - mx;
    const y = point.y - my;
    a += x * x;
    b += x * y;
    c += y * y;
  }
  const angle = 0.5 * Math.atan2(2 * b, a - c);
  const east = Math.cos(angle);
  const north = Math.sin(angle);
  let alongMin = Infinity;
  let alongMax = -Infinity;
  let crossMin = Infinity;
  let crossMax = -Infinity;
  for (const point of points) {
    const x = point.x - mx;
    const y = point.y - my;
    const along = x * east + y * north;
    const cross = x * -north + y * east;
    alongMin = Math.min(alongMin, along);
    alongMax = Math.max(alongMax, along);
    crossMin = Math.min(crossMin, cross);
    crossMax = Math.max(crossMax, cross);
  }
  let lengthKm = alongMax - alongMin;
  let widthKm = crossMax - crossMin;
  let axis = (Math.atan2(east, north) * 180) / Math.PI;
  if (widthKm > lengthKm) {
    [lengthKm, widthKm] = [widthKm, lengthKm];
    axis += 90;
  }
  return { lengthKm, widthKm, axisDeg: (axis + 360) % 360 };
}

export function measureGeometry(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): SwathStats {
  const outers = outerRings(geometry).flatMap(ringPairs);
  if (outers.length < 3) return { lengthMi: 0, widthMi: 0, areaSqMi: 0, axisDeg: null };
  const originLon = outers.reduce((sum, pair) => sum + pair[0], 0) / outers.length;
  const originLat = outers.reduce((sum, pair) => sum + pair[1], 0) / outers.length;
  let areaSqKm = 0;
  for (const polygon of polygonsOf(geometry)) {
    const [outer, ...holes] = polygon;
    if (!outer) continue;
    areaSqKm += shoelaceSqKm(ringPairs(outer), originLon, originLat);
    for (const hole of holes) areaSqKm -= shoelaceSqKm(ringPairs(hole), originLon, originLat);
  }
  const span = axes(outers, originLon, originLat);
  return {
    lengthMi: Math.max(0, span.lengthKm / KM_PER_MI),
    widthMi: Math.max(0, span.widthKm / KM_PER_MI),
    areaSqMi: Math.max(0, areaSqKm / (KM_PER_MI * KM_PER_MI)),
    axisDeg: span.axisDeg,
  };
}

function centroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { lon: number; lat: number } | null {
  const ring = outerRings(geometry)[0];
  const pairs = ring ? ringPairs(ring) : [];
  if (!pairs.length) return null;
  return {
    lon: pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length,
    lat: pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length,
  };
}

function pointInOuter(lon: number, lat: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  return outerRings(geometry).some((ring) => {
    const pairs = ringPairs(ring);
    let inside = false;
    for (let i = 0, j = pairs.length - 1; i < pairs.length; j = i, i += 1) {
      const [xi, yi] = pairs[i];
      const [xj, yj] = pairs[j];
      const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  });
}

function isPoly(geometry: GeoJSON.Geometry | null | undefined): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

function combine(parts: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const coordinates = parts.flatMap((part) => (part.type === "Polygon" ? [part.coordinates] : part.coordinates));
  if (coordinates.length === 1) return { type: "Polygon", coordinates: coordinates[0] };
  return { type: "MultiPolygon", coordinates };
}

export interface MeasuredSelection {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  minIn: number | null;
  maxIn: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  startLat?: number | null;
  startLon?: number | null;
  endLat?: number | null;
  endLon?: number | null;
}

/** Per-band size of the clicked swath, plus any heavier band nested inside it. */
export function readoutForSelection(
  selection: MeasuredSelection,
  features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }> = [],
): SwathReadout {
  const pieces: Array<{ minIn: number; maxIn: number; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; stats: SwathStats }> = [];
  const seen = new Set<string>();
  const add = (minIn: number, maxIn: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) => {
    const center = centroid(geometry);
    const key = `${bandOf(minIn).minIn}|${center ? center.lon.toFixed(3) : "x"}|${center ? center.lat.toFixed(3) : "y"}`;
    if (seen.has(key)) return;
    seen.add(key);
    pieces.push({ minIn, maxIn, geometry, stats: measureGeometry(geometry) });
  };
  add(selection.minIn ?? selection.maxIn ?? 0, selection.maxIn ?? selection.minIn ?? 0, selection.geometry);
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!isPoly(geometry)) continue;
    const minIn = Number(feature.properties?.minIn ?? feature.properties?.maxSizeIn);
    const hail = Number.isFinite(minIn) ? minIn : 0;
    if ((selection.minIn ?? 0) > 0 && hail + 1e-6 < (selection.minIn ?? 0)) continue;
    const center = centroid(geometry);
    if (!center || !pointInOuter(center.lon, center.lat, selection.geometry)) continue;
    const maxIn = Number(feature.properties?.maxIn ?? feature.properties?.maxSizeIn);
    add(hail, Number.isFinite(maxIn) ? maxIn : hail, geometry);
  }
  const grouped = new Map<number, { label: string; parts: typeof pieces }>();
  for (const piece of pieces) {
    const band = bandOf(piece.minIn);
    const group = grouped.get(band.minIn) ?? { label: band.label, parts: [] };
    group.parts.push(piece);
    grouped.set(band.minIn, group);
  }
  const rawBands = [...grouped.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([minIn, group]) => {
      const geometry = combine(group.parts.map((part) => part.geometry));
      return { minIn, label: group.label, geometry, ...measureGeometry(geometry) };
    });
  const bands = rawBands.map((band) => {
    let areaSqMi = band.areaSqMi;
    for (const other of rawBands) {
      if (other.minIn <= band.minIn) continue;
      const center = centroid(other.geometry);
      if (!center || !pointInOuter(center.lon, center.lat, band.geometry)) continue;
      if (other.areaSqMi < areaSqMi) areaSqMi -= other.areaSqMi;
    }
    return { minIn: band.minIn, label: band.label, lengthMi: band.lengthMi, widthMi: band.widthMi, areaSqMi: Math.max(0, areaSqMi), axisDeg: band.axisDeg };
  });
  const unionGeometry = rawBands.length <= 1 ? rawBands[0]?.geometry : combine(rawBands.map((band) => band.geometry));
  const unionStats = unionGeometry ? measureGeometry(unionGeometry) : { lengthMi: 0, widthMi: 0, areaSqMi: 0, axisDeg: null };
  const total = {
    lengthMi: Math.max(unionStats.lengthMi, ...rawBands.map((band) => band.lengthMi), 0),
    widthMi: Math.max(unionStats.widthMi, ...rawBands.map((band) => band.widthMi), 0),
    areaSqMi: bands.reduce((sum, band) => sum + band.areaSqMi, 0),
    axisDeg: unionStats.axisDeg,
  };
  const floors = new Set(bands.map((band) => band.minIn));
  const peakCandidates = [selection.maxIn, selection.minIn, ...pieces.flatMap((piece) => [piece.maxIn, piece.minIn])].filter(
    (value): value is number => value != null && Number.isFinite(value) && value > 0 && floors.has(bandOf(value).minIn),
  );
  const peakIn = peakCandidates.length ? Math.max(...peakCandidates) : (bands[0]?.minIn ?? 0);
  const direction =
    selection.startLat != null && selection.startLon != null && selection.endLat != null && selection.endLon != null
      ? movingLabel(selection.startLat, selection.startLon, selection.endLat, selection.endLon)
      : null;
  return {
    bands,
    total,
    peakIn,
    motion: { direction, startedAt: selection.startedAt ?? null, endedAt: selection.endedAt ?? null },
  };
}
