import { project } from "@/lib/geo";

export const VEHICLES_PER_SQ_MI = 900;
export const ROOFS_PER_SQ_MI = 450;
export const DEFAULT_PRICES = {
  pdrLow: 175,
  pdrHigh: 450,
  roofLow: 6500,
  roofHigh: 14000,
};

export interface JobPrices {
  pdrLow: number;
  pdrHigh: number;
  roofLow: number;
  roofHigh: number;
}

export interface ForecastLine {
  hailIn: number;
  label: string;
  areaSqMi: number;
  vehicles: number;
  roofs: number;
  vehicleSource: "counted" | "assumed";
  roofSource: "counted" | "assumed";
}

export interface ForecastBand {
  minIn: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

function ringAreaSqMi(ring: number[][]): number {
  if (ring.length < 4) return 0;
  const originLon = ring[0][0];
  const originLat = ring[0][1];
  const points = ring.map(([lon, lat]) => project(lon, lat, originLon, originLat));
  let sum = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    sum += points[index].x * points[index + 1].y - points[index + 1].x * points[index].y;
  }
  return Math.abs(sum) / 2 / 2.589988;
}

export function geometryAreaSqMi(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let total = 0;
  for (const polygon of polygons) {
    const outer = polygon[0];
    if (!outer) continue;
    total += ringAreaSqMi(outer);
  }
  return Math.round(total * 100) / 100;
}

export function circlePolygon(lat: number, lon: number, radiusKm: number, steps = 16): GeoJSON.Polygon {
  const ring: number[][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    ring.push([
      lon + ((radiusKm / (111.32 * Math.cos(latRad))) * Math.sin(angle)),
      lat + ((radiusKm / 110.574) * Math.cos(angle)),
    ]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

function bandLabel(hailIn: number): string {
  if (hailIn >= 2.5) return '2.5"+';
  if (hailIn >= 2) return '2"';
  if (hailIn >= 1.5) return '1.5"';
  if (hailIn >= 1) return '1"';
  return '<1"';
}

function counts(areaSqMi: number, vehicles: number | null, homes: number | null): Pick<ForecastLine, "vehicles" | "roofs" | "vehicleSource" | "roofSource"> {
  const vehicleSource = vehicles != null ? "counted" : "assumed";
  const roofSource = homes != null ? "counted" : "assumed";
  return {
    vehicles: vehicles != null ? Math.max(0, Math.round(vehicles)) : Math.max(0, Math.round(areaSqMi * VEHICLES_PER_SQ_MI)),
    roofs: homes != null ? Math.max(0, Math.round(homes)) : Math.max(0, Math.round(areaSqMi * ROOFS_PER_SQ_MI)),
    vehicleSource,
    roofSource,
  };
}

export function buildForecast(input: {
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  fallbackHail: number;
  bands?: ForecastBand[];
  vehicles?: number | null;
  homes?: number | null;
}): ForecastLine[] {
  const measured = input.vehicles != null || input.homes != null;
  const fallback = Number.isFinite(input.fallbackHail) && input.fallbackHail > 0 ? input.fallbackHail : 0.75;
  if (measured) {
    const areaSqMi = geometryAreaSqMi(input.geometry);
    return [
      {
        hailIn: Math.round(fallback * 100) / 100,
        label: bandLabel(fallback),
        areaSqMi,
        ...counts(areaSqMi, input.vehicles ?? null, input.homes ?? null),
      },
    ];
  }
  const grouped = new Map<number, number>();
  for (const band of input.bands ?? []) {
    if (!Number.isFinite(band.minIn) || band.minIn <= 0) continue;
    const areaSqMi = geometryAreaSqMi(band.geometry);
    if (areaSqMi <= 0 || areaSqMi > 40) continue;
    const hail = Math.round(band.minIn * 100) / 100;
    grouped.set(hail, (grouped.get(hail) ?? 0) + areaSqMi);
  }
  if (!grouped.size) grouped.set(Math.round(fallback * 100) / 100, geometryAreaSqMi(input.geometry));
  return [...grouped.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([hailIn, areaSqMi]) => ({
      hailIn,
      label: bandLabel(hailIn),
      areaSqMi: Math.round(areaSqMi * 100) / 100,
      ...counts(areaSqMi, null, null),
    }));
}

export function dollarRange(count: number, low: number, high: number): { low: number; high: number } {
  return { low: Math.round(count * low), high: Math.round(count * high) };
}

export function sumDollars(lines: ForecastLine[], prices: JobPrices): { pdr: { low: number; high: number }; roof: { low: number; high: number } } {
  const vehicles = lines.reduce((sum, line) => sum + line.vehicles, 0);
  const roofs = lines.reduce((sum, line) => sum + line.roofs, 0);
  return {
    pdr: dollarRange(vehicles, prices.pdrLow, prices.pdrHigh),
    roof: dollarRange(roofs, prices.roofLow, prices.roofHigh),
  };
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

export function bandsFromFeatures(
  features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }> | undefined,
): ForecastBand[] {
  const bands: ForecastBand[] = [];
  for (const feature of features ?? []) {
    const minIn = Number(feature.properties?.minIn);
    const geometry = feature.geometry;
    if (!Number.isFinite(minIn) || minIn <= 0 || !geometry) continue;
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") continue;
    bands.push({ minIn, geometry });
    if (bands.length >= 8) break;
  }
  return bands;
}

export function moneyLabel(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
