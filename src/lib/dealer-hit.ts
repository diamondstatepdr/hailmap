import type { DealerPin } from "@/lib/area-selection";
import { pointInGeometry } from "@/lib/geo";

export interface LotBand {
  minIn: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export function telHref(phone: string | null): string | null {
  if (!phone) return null;
  const keep = phone.replace(/[^\d+]/g, "");
  const digits = keep.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:${keep}`;
}

export function dealerDirections(lat: number, lon: number): { google: string; apple: string } {
  const coord = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(coord)}&travelmode=driving`,
    apple: `https://maps.apple.com/?daddr=${coord}&dirflg=d`,
  };
}

export function hailAtLot(lat: number, lon: number, bands: LotBand[], fallback: number): number {
  let best = 0;
  for (const band of bands) {
    if (!Number.isFinite(band.minIn) || band.minIn <= best) continue;
    if (pointInGeometry(lon, lat, band.geometry)) best = band.minIn;
  }
  if (best > 0) return Math.round(Math.min(8, best) * 100) / 100;
  const n = Number(fallback);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(8, n) * 100) / 100;
}

/** Highest hail at the lot first. Distance order is only the tie break, so the finder stays distance-sorted when hail is equal. */
export function rankDealersByHail(
  dealers: DealerPin[],
  bands: LotBand[],
  fallback: number,
): Array<DealerPin & { hailIn: number }> {
  return dealers
    .map((dealer) => ({ ...dealer, hailIn: hailAtLot(dealer.lat, dealer.lon, bands, fallback) }))
    .sort((a, b) => b.hailIn - a.hailIn || a.distanceKm - b.distanceKm || a.name.localeCompare(b.name));
}

/** Hail bands on the map, scored from the real polygons so a lot is not pulled into a neighboring size. */
export function lotBands(
  features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }>,
): LotBand[] {
  const bands: LotBand[] = [];
  for (const feature of features) {
    const minIn = Number(feature.properties?.minIn);
    const geometry = feature.geometry;
    if (!Number.isFinite(minIn) || minIn <= 0 || !geometry) continue;
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") continue;
    bands.push({ minIn, geometry });
    if (bands.length >= 80) break;
  }
  return bands;
}
