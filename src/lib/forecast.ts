import { pointInGeometry } from "@/lib/geo";
import { measureGeometry } from "@/lib/swath-measure";
import {
  BACKTESTS,
  CREW_CAPTURE_RATE,
  DAMAGE_BANDS,
  DEFAULT_PRICES,
  type BacktestStorm,
  type DamageBand,
  type RateBasis,
} from "@/lib/forecast-sources";

export { DEFAULT_PRICES };

export interface JobPrices {
  pdrLow: number;
  pdrHigh: number;
  roofLow: number;
  roofHigh: number;
}

export interface ForecastBand {
  minIn: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface ForecastQuery {
  selection: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  selectionHail: number;
  /** True when the selected polygon is itself a hail band (a clicked swath). */
  selectionIsBand: boolean;
  bands: ForecastBand[];
  vehicles: number | null;
  homes: number | null;
}

export interface ExposureTract {
  lat: number;
  lon: number;
  homes: number;
  vehicles: number | null;
}

export type ExposureSource = "census" | "counted" | "unavailable";

export interface ExposureLine {
  hailIn: number;
  label: string;
  vehicles: number | null;
  roofs: number;
  vehicleRate: number;
  roofRate: number;
  damagedVehicles: number | null;
  damagedRoofs: number;
  vehicleBasis: RateBasis;
  roofBasis: RateBasis;
  vehicleSource: ExposureSource;
  roofSource: ExposureSource;
  /** Exclusive square miles of this hail band, from the swath geometry. */
  areaSqMi: number;
}

export interface ForecastResult {
  lines: ExposureLine[];
  exposure: ExposureSource;
  partial: boolean;
  unavailable: boolean;
  note: string | null;
}

interface Bucket {
  band: DamageBand;
  roofs: number;
  vehicles: number;
  vehiclesKnown: boolean;
}

export function bandForHail(hailIn: number): DamageBand {
  let match = DAMAGE_BANDS[0];
  for (const band of DAMAGE_BANDS) {
    if (hailIn + 1e-9 >= band.minIn) match = band;
  }
  return match;
}

export function basisTag(basis: RateBasis): string | null {
  if (basis === "assumption") return "assumption";
  if (basis === "storm") return "2016 claims";
  return null;
}

function ringContains(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Inside the outer ring, counting nested-band holes as part of the swath. */
export function pointInOuter(lon: number, lat: number, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const rings = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.coordinates.map((polygon) => polygon[0]);
  return rings.some((ring) => Array.isArray(ring) && ringContains(lon, lat, ring));
}

function ringCentroid(ring: number[][]): { lon: number; lat: number } | null {
  const last = ring.length - 1;
  const open =
    ring.length > 1 && ring[0]?.[0] === ring[last]?.[0] && ring[0]?.[1] === ring[last]?.[1] ? ring.slice(0, -1) : ring;
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const pair of open) {
    const x = Number(pair?.[0]);
    const y = Number(pair?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    lon += x;
    lat += y;
    count += 1;
  }
  if (!count) return null;
  return { lon: lon / count, lat: lat / count };
}

export function geometryCentroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): { lon: number; lat: number } | null {
  const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!ring) return null;
  return ringCentroid(ring);
}

function isPolygonGeometry(geometry: GeoJSON.Geometry | null | undefined): geometry is GeoJSON.Polygon | GeoJSON.MultiPolygon {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

/**
 * Mesh polygons that belong to the selected swath: the polygon itself and
 * heavier bands nested in it. A probe point (a Money Hole) also keeps bands
 * that cover that point even when their centroid sits outside the circle.
 */
export function bandsForSelection(
  features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: GeoJSON.GeoJsonProperties }> | undefined,
  selection: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  selectionMinIn: number,
  probe?: { lon: number; lat: number },
): ForecastBand[] {
  const bands: ForecastBand[] = [];
  for (const feature of features ?? []) {
    const minIn = Number(feature.properties && typeof feature.properties === "object" ? feature.properties.minIn : NaN);
    const geometry = feature.geometry;
    if (!Number.isFinite(minIn) || minIn <= 0 || !isPolygonGeometry(geometry)) continue;
    if (selectionMinIn > 0 && minIn + 1e-6 < selectionMinIn) continue;
    const centroid = geometryCentroid(geometry);
    const centroidInside = centroid ? pointInOuter(centroid.lon, centroid.lat, selection) : false;
    const probeInside = probe
      ? pointInGeometry(probe.lon, probe.lat, geometry) || pointInOuter(probe.lon, probe.lat, geometry)
      : false;
    if (!centroidInside && !probeInside) continue;
    bands.push({ minIn, geometry });
  }
  return bands;
}

export function circlePolygon(lat: number, lon: number, radiusKm: number, steps = 16): GeoJSON.Polygon {
  const ring: number[][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([
      lon + (radiusKm / (111.32 * Math.cos(latRad))) * Math.sin(angle),
      lat + (radiusKm / 110.574) * Math.cos(angle),
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/**
 * Square miles of each damage band. A band polygon's own holes are already
 * removed, so a nested core is counted on its own line and not again here.
 */
export function bandAreas(query: ForecastQuery): Map<number, number> {
  const parts = query.selectionIsBand
    ? [...query.bands, { minIn: query.selectionHail, geometry: query.selection }]
    : [...query.bands];
  const areas = new Map<number, number>();
  const seen = new Set<string>();
  for (const part of parts) {
    const stats = measureGeometry(part.geometry);
    const fingerprint = `${bandForHail(part.minIn).minIn}|${stats.areaSqMi.toFixed(3)}|${stats.lengthMi.toFixed(3)}|${stats.widthMi.toFixed(3)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const key = bandForHail(part.minIn).minIn;
    areas.set(key, (areas.get(key) ?? 0) + stats.areaSqMi);
  }
  return areas;
}

function lineFromBucket(bucket: Bucket, source: "census" | "counted", areaSqMi: number): ExposureLine {
  const vehicles = bucket.vehiclesKnown ? Math.max(0, Math.round(bucket.vehicles)) : null;
  const roofs = Math.max(0, Math.round(bucket.roofs));
  return {
    hailIn: bucket.band.minIn,
    label: bucket.band.label,
    vehicles,
    roofs,
    vehicleRate: bucket.band.vehicleRate,
    roofRate: bucket.band.roofRate,
    damagedVehicles: vehicles == null ? null : Math.round(vehicles * bucket.band.vehicleRate),
    damagedRoofs: Math.round(roofs * bucket.band.roofRate),
    vehicleBasis: bucket.band.vehicleBasis,
    roofBasis: bucket.band.roofBasis,
    vehicleSource: vehicles == null ? "unavailable" : source,
    roofSource: source,
    areaSqMi,
  };
}

/** Put each tract in the heaviest band that contains it. Nested bands are not double-counted. */
export function assignExposure(query: ForecastQuery, tracts: ExposureTract[]): ExposureLine[] {
  const bands = query.selectionIsBand
    ? [...query.bands, { minIn: query.selectionHail, geometry: query.selection }]
    : query.bands;
  const buckets = new Map<number, Bucket>();
  for (const tract of tracts) {
    if (!Number.isFinite(tract.lat) || !Number.isFinite(tract.lon)) continue;
    if (!pointInOuter(tract.lon, tract.lat, query.selection)) continue;
    let hail: number | null = null;
    for (const band of bands) {
      if (!pointInGeometry(tract.lon, tract.lat, band.geometry)) continue;
      if (hail == null || band.minIn > hail) hail = band.minIn;
    }
    if (hail == null) continue;
    const damage = bandForHail(hail);
    const bucket = buckets.get(damage.minIn) ?? { band: damage, roofs: 0, vehicles: 0, vehiclesKnown: false };
    bucket.roofs += Math.max(0, tract.homes);
    if (tract.vehicles != null && Number.isFinite(tract.vehicles)) {
      bucket.vehicles += Math.max(0, tract.vehicles);
      bucket.vehiclesKnown = true;
    }
    buckets.set(damage.minIn, bucket);
  }
  const areas = bandAreas(query);
  return [...buckets.values()]
    .filter((bucket) => bucket.roofs > 0 || bucket.vehicles > 0)
    .sort((a, b) => b.band.minIn - a.band.minIn)
    .map((bucket) => lineFromBucket(bucket, "census", areas.get(bucket.band.minIn) ?? 0));
}

function countedLine(query: ForecastQuery): ExposureLine | null {
  const vehicles = query.vehicles != null && query.vehicles > 0 ? Math.round(query.vehicles) : null;
  const homes = query.homes != null && query.homes > 0 ? Math.round(query.homes) : null;
  if (vehicles == null && homes == null) return null;
  const band = bandForHail(query.selectionHail);
  const areaSqMi = bandAreas(query).get(band.minIn) ?? measureGeometry(query.selection).areaSqMi;
  return lineFromBucket(
    {
      band,
      roofs: homes ?? 0,
      vehicles: vehicles ?? 0,
      vehiclesKnown: vehicles != null,
    },
    "counted",
    areaSqMi,
  );
}

export function resolveExposure(query: ForecastQuery, tracts: ExposureTract[], partial = false): ForecastResult {
  const lines = assignExposure(query, tracts);
  const homes = lines.reduce((sum, line) => sum + line.roofs, 0);
  const vehicles = lines.reduce((sum, line) => sum + (line.vehicles ?? 0), 0);
  if (homes > 0 || vehicles > 0) {
    const vehicleGap = lines.some((line) => line.vehicleSource === "unavailable");
    return {
      lines,
      exposure: "census",
      partial,
      unavailable: false,
      note: [
        partial ? "Some counties did not load, so this count is incomplete." : null,
        vehicleGap ? "Vehicle counts did not load. Roof exposure is Census housing units." : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
    };
  }
  const counted = countedLine(query);
  if (counted) {
    return {
      lines: [counted],
      exposure: "counted",
      partial: false,
      unavailable: false,
      note: "Census tract centroids missed this spot. The Money Hole count is placed in this spot's hail band.",
    };
  }
  return {
    lines: [],
    exposure: "unavailable",
    partial,
    unavailable: true,
    note: "Census counts are unavailable here, and this spot has no counted vehicles or roofs.",
  };
}

export function dollarRange(count: number, low: number, high: number): { low: number; high: number } {
  return { low: Math.round(count * low), high: Math.round(count * high) };
}

export function sumDollars(
  lines: ExposureLine[],
  prices: JobPrices,
): {
  pdr: { low: number; high: number } | null;
  roof: { low: number; high: number };
  damagedVehicles: number | null;
  damagedRoofs: number;
} {
  let pdrLow = 0;
  let pdrHigh = 0;
  let roofLow = 0;
  let roofHigh = 0;
  let damagedVehicles = 0;
  let vehiclesKnown = false;
  let damagedRoofs = 0;
  for (const line of lines) {
    damagedRoofs += line.damagedRoofs;
    const roof = dollarRange(line.damagedRoofs, prices.roofLow, prices.roofHigh);
    roofLow += roof.low;
    roofHigh += roof.high;
    if (line.damagedVehicles == null) continue;
    vehiclesKnown = true;
    damagedVehicles += line.damagedVehicles;
    const pdr = dollarRange(line.damagedVehicles, prices.pdrLow, prices.pdrHigh);
    pdrLow += pdr.low;
    pdrHigh += pdr.high;
  }
  return {
    pdr: vehiclesKnown ? { low: pdrLow, high: pdrHigh } : null,
    roof: { low: roofLow, high: roofHigh },
    damagedVehicles: vehiclesKnown ? damagedVehicles : null,
    damagedRoofs,
  };
}

export function captureCount(damaged: number): number {
  return Math.round(damaged * CREW_CAPTURE_RATE);
}

function compact(value: number, divisor: number, suffix: string): string {
  const scaled = Math.round((value / divisor) * 10) / 10;
  const digits = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
  return `$${digits}${suffix}`;
}

/** Compact dollars: $2.3M, $397k, $1,750. No estimate prefix — callers add ~. */
export function moneyLabel(value: number): string {
  const n = Math.round(value);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}${compact(abs, 1_000_000_000, "B")}`;
  if (abs >= 1_000_000) return `${sign}${compact(abs, 1_000_000, "M")}`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/** Every dollar figure is a range with an estimate mark. */
export function estimateRange(low: number, high: number): string {
  const left = moneyLabel(low);
  const right = moneyLabel(high);
  if (left === right) return `~${left}`;
  return `~${left}–${right}`;
}

export function percentLabel(rate: number): string {
  if (rate <= 0) return "0%";
  return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`;
}

export interface BacktestSide {
  claims: number;
  published: number | null;
  low: number;
  high: number;
  containsPublished: boolean | null;
}

export interface BacktestResult {
  id: string;
  name: string;
  date: string;
  sourceName: string;
  sourceUrl: string;
  note: string;
  auto: BacktestSide;
  property: BacktestSide;
  total: { published: number; low: number; high: number; containsPublished: boolean };
}

function side(claims: number, published: number | null, lowTicket: number, highTicket: number): BacktestSide {
  const low = Math.round(claims * lowTicket);
  const high = Math.round(claims * highTicket);
  return {
    claims,
    published,
    low,
    high,
    containsPublished: published == null ? null : published >= low && published <= high,
  };
}

/** Published claim counts times the ticket range, compared with the published loss. */
export function backtestStorm(storm: BacktestStorm, prices: JobPrices = DEFAULT_PRICES): BacktestResult {
  const auto = side(storm.autoClaims, storm.autoLoss, prices.pdrLow, prices.pdrHigh);
  const property = side(storm.propertyClaims, storm.propertyLoss, prices.roofLow, prices.roofHigh);
  const low = auto.low + property.low;
  const high = auto.high + property.high;
  return {
    id: storm.id,
    name: storm.name,
    date: storm.date,
    sourceName: storm.sourceName,
    sourceUrl: storm.sourceUrl,
    note: storm.note,
    auto,
    property,
    total: {
      published: storm.totalLoss,
      low,
      high,
      containsPublished: storm.totalLoss >= low && storm.totalLoss <= high,
    },
  };
}

export function backtestResults(prices: JobPrices = DEFAULT_PRICES): BacktestResult[] {
  return BACKTESTS.map((storm) => backtestStorm(storm, prices));
}

function money(value: unknown): number | null {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 100000) return null;
  return n;
}

export function normalizePrices(input: unknown): JobPrices | { error: string } {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const pdrLow = money(row.pdrLow);
  const pdrHigh = money(row.pdrHigh);
  const roofLow = money(row.roofLow);
  const roofHigh = money(row.roofHigh);
  if (pdrLow == null || pdrHigh == null || roofLow == null || roofHigh == null) {
    return { error: "Enter prices from $1 to $100,000." };
  }
  if (pdrLow > pdrHigh || roofLow > roofHigh) return { error: "The low price has to be at or under the high price." };
  return { pdrLow, pdrHigh, roofLow, roofHigh };
}

function asPolygon(value: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as { type?: string; coordinates?: unknown };
  if ((geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") || !Array.isArray(geometry.coordinates)) return null;
  return geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export function parseForecastQuery(input: unknown): ForecastQuery | { error: string } {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const selection = asPolygon(row.selection);
  if (!selection) return { error: "Choose a swath or Money Hole first." };
  const selectionHail = Number(row.selectionHail);
  const vehicles = Number(row.vehicles);
  const homes = Number(row.homes);
  const bands: ForecastBand[] = [];
  if (Array.isArray(row.bands)) {
    for (const band of row.bands) {
      if (!band || typeof band !== "object") continue;
      const item = band as { minIn?: unknown; geometry?: unknown };
      const minIn = Number(item.minIn);
      const geometry = asPolygon(item.geometry);
      if (!Number.isFinite(minIn) || minIn <= 0 || !geometry) continue;
      bands.push({ minIn, geometry });
      if (bands.length >= 200) break;
    }
  }
  return {
    selection,
    selectionHail: Number.isFinite(selectionHail) && selectionHail > 0 ? selectionHail : 0.75,
    selectionIsBand: row.selectionIsBand === true,
    bands,
    vehicles: Number.isFinite(vehicles) && vehicles > 0 ? vehicles : null,
    homes: Number.isFinite(homes) && homes > 0 ? homes : null,
  };
}
