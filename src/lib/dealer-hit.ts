import type { DealerPin } from "@/lib/area-selection";
import { pointInGeometry } from "@/lib/geo";

export interface LotBand {
  minIn: number;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

function roundInches(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(Math.min(8, value) * 100) / 100;
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

/**
 * Hail at a lot is the MESH inches when that sample sits in the heaviest band
 * covering the point. A sample from a heavier band that does not cover the lot
 * stays at the covering band's floor instead of the swath peak.
 */
export function hailAtLot(lat: number, lon: number, bands: LotBand[], fallback: number, meshIn?: number | null): number {
  let floor = 0;
  for (const band of bands) {
    if (!Number.isFinite(band.minIn) || band.minIn <= floor) continue;
    if (pointInGeometry(lon, lat, band.geometry)) floor = band.minIn;
  }
  const mesh = meshIn != null && Number.isFinite(meshIn) && meshIn > 0 ? meshIn : null;
  if (mesh != null && (floor === 0 || mesh + 0.02 >= floor)) {
    return roundInches(Math.max(mesh, floor));
  }
  if (floor > 0) return roundInches(floor);
  if (mesh != null) return roundInches(mesh);
  return roundInches(Number(fallback));
}

/** Highest hail at the lot first. Distance order is only the tie break, so the finder stays distance-sorted when hail is equal. */
export function rankDealersByHail(
  dealers: DealerPin[],
  bands: LotBand[],
  fallback: number,
): Array<DealerPin & { hailIn: number }> {
  return dealers
    .map((dealer) => ({ ...dealer, hailIn: hailAtLot(dealer.lat, dealer.lon, bands, fallback, dealer.meshIn) }))
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
  }
  return bands;
}
