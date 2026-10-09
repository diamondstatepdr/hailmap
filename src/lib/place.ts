import { haversineKm, pointInGeometry } from "@/lib/geo";
import { efRank, hazardOf, magnitudeLabel } from "@/lib/hazard";
import { scoreDamage, type DamageScore } from "@/lib/probability";
import { reportsToSwaths } from "@/lib/swath";
import type { HailReport } from "@/lib/types";

export interface PlaceWarning {
  event: string;
  kind: string;
  until: string | null;
  hazard: string | null;
}

export interface PlaceHistory {
  lat: number;
  lon: number;
  radiusKm: number;
  hours: number;
  reports: Array<HailReport & { distanceKm: number }>;
  maxHailIn: number | null;
  maxWindMph: number | null;
  strongestTornado: string | null;
  nearestKm: number | null;
  swathHit: boolean;
  swathMaxSizeIn: number | null;
  warnings: PlaceWarning[];
  warningStatus: "ok" | "unavailable";
  score: DamageScore;
}

const SWATH_CONTEXT_KM = 60;

export function alertsAtPoint(
  lat: number,
  lon: number,
  collection: GeoJSON.FeatureCollection | null | undefined,
): PlaceWarning[] {
  const warnings: PlaceWarning[] = [];
  for (const feature of collection?.features ?? []) {
    const props = feature.properties ?? {};
    const kind = String(props.kind ?? "");
    if (kind !== "warning" && kind !== "watch" && kind !== "statement") continue;
    if (!pointInGeometry(lon, lat, feature.geometry)) continue;
    const event = String(props.event ?? "").trim();
    if (!event) continue;
    warnings.push({
      event,
      kind,
      until: props.until ? String(props.until) : null,
      hazard: props.hazard ? String(props.hazard) : null,
    });
  }
  return warnings;
}

export function swathEvidence(lat: number, lon: number, reports: HailReport[]): { hit: boolean; maxSizeIn: number | null } {
  const context = reports.filter(
    (report) => hazardOf(report.hazard) === "hail" && haversineKm(lat, lon, report.lat, report.lon) <= SWATH_CONTEXT_KM,
  );
  const swaths = reportsToSwaths(
    context.map((report) => ({
      id: report.id,
      lat: report.lat,
      lon: report.lon,
      occurredAt: report.occurredAt,
      sizeIn: report.sizeIn,
      confidence: report.confidence,
    })),
  );
  let hit = false;
  let maxSizeIn: number | null = null;
  for (const feature of swaths.features) {
    if (!pointInGeometry(lon, lat, feature.geometry)) continue;
    hit = true;
    const size = feature.properties?.maxSizeIn;
    if (typeof size === "number" && Number.isFinite(size)) {
      maxSizeIn = maxSizeIn == null ? size : Math.max(maxSizeIn, size);
    }
  }
  return { hit, maxSizeIn };
}

export function buildPlaceHistory(input: {
  lat: number;
  lon: number;
  radiusKm: number;
  hours: number;
  now?: number;
  reports: HailReport[];
  warnings?: GeoJSON.FeatureCollection | null;
  warningStatus?: "ok" | "unavailable";
  /** When set, swath coverage is not recomputed from `reports`. */
  swath?: { hit: boolean; maxSizeIn: number | null };
}): PlaceHistory {
  const now = input.now ?? Date.now();
  const cutoff = now - input.hours * 3600 * 1000;
  const inWindow = input.reports.filter((report) => {
    const time = Date.parse(report.occurredAt);
    return !Number.isNaN(time) && time >= cutoff && time <= now + 15 * 60 * 1000;
  });
  const nearby = inWindow
    .map((report) => ({ ...report, distanceKm: haversineKm(input.lat, input.lon, report.lat, report.lon) }))
    .filter((report) => report.distanceKm <= input.radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  let maxHailIn: number | null = null;
  let maxWindMph: number | null = null;
  let strongestTornado: string | null = null;
  for (const report of nearby) {
    if (hazardOf(report.hazard) === "hail" && report.sizeIn != null) {
      maxHailIn = maxHailIn == null ? report.sizeIn : Math.max(maxHailIn, report.sizeIn);
    }
    if (hazardOf(report.hazard) === "wind" && report.windMph != null) {
      maxWindMph = maxWindMph == null ? report.windMph : Math.max(maxWindMph, report.windMph);
    }
    if (hazardOf(report.hazard) === "tornado" && efRank(report.efRating) > efRank(strongestTornado)) {
      strongestTornado = report.efRating;
    }
  }

  const swath = input.swath ?? swathEvidence(input.lat, input.lon, inWindow);
  const warningStatus = input.warningStatus ?? (input.warnings ? "ok" : "unavailable");
  const warnings = warningStatus === "ok" ? alertsAtPoint(input.lat, input.lon, input.warnings) : [];
  const score = scoreDamage({
    lat: input.lat,
    lon: input.lon,
    radiusKm: input.radiusKm,
    now,
    reports: nearby,
    swath,
  });

  return {
    lat: input.lat,
    lon: input.lon,
    radiusKm: input.radiusKm,
    hours: input.hours,
    reports: nearby,
    maxHailIn,
    maxWindMph,
    strongestTornado,
    nearestKm: nearby[0]?.distanceKm ?? null,
    swathHit: swath.hit,
    swathMaxSizeIn: swath.maxSizeIn,
    warnings,
    warningStatus,
    score,
  };
}

export function magnitudeOf(report: HailReport): string {
  return magnitudeLabel(report);
}
