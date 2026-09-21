import { confidenceRank, type Confidence } from "@/lib/confidence";
import { sortDamageTags } from "@/lib/damage";
import { haversineKm } from "@/lib/geo";

export const DEDUPE_RADIUS_KM = 10;
export const DEDUPE_WINDOW_MINUTES = 45;
export const DEDUPE_SIZE_TOLERANCE_IN = 0.5;

export interface DedupeReport {
  id: string;
  lat: number;
  lon: number;
  occurredAt: string;
  sizeIn: number | null;
  confidence: Confidence;
  damageTags?: string[];
  remark?: string | null;
  /** Set when the report has a stored photo. Those pins are never dropped. */
  photoId?: string | null;
  photoUrl?: string | null;
}

export interface DedupeOptions {
  radiusKm?: number;
  windowMinutes?: number;
  sizeToleranceIn?: number;
}

/**
 * Collapse nearby reports of similar size into one marker.
 * The survivor is the highest-confidence report. Damage tags are unioned.
 * A community photo is kept as its own pin so fusion cannot drop the photo
 * or replace an official report with it.
 */
export function fuseReports<T extends DedupeReport>(reports: T[], options: DedupeOptions = {}): T[] {
  const radiusKm = options.radiusKm ?? DEDUPE_RADIUS_KM;
  const windowMs = (options.windowMinutes ?? DEDUPE_WINDOW_MINUTES) * 60 * 1000;
  const sizeTolerance = options.sizeToleranceIn ?? DEDUPE_SIZE_TOLERANCE_IN;

  const ranked = [...reports].sort((a, b) => {
    const byConfidence = confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (byConfidence) return byConfidence;
    const bySize = (b.sizeIn ?? -1) - (a.sizeIn ?? -1);
    if (bySize) return bySize;
    return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  });

  const kept: T[] = [];
  for (const report of ranked) {
    const time = Date.parse(report.occurredAt);
    const match = kept.find((existing) => {
      const existingTime = Date.parse(existing.occurredAt);
      if (Number.isNaN(time) || Number.isNaN(existingTime)) return false;
      if (Math.abs(existingTime - time) > windowMs) return false;
      if (haversineKm(existing.lat, existing.lon, report.lat, report.lon) > radiusKm) return false;
      if (
        existing.sizeIn != null &&
        report.sizeIn != null &&
        Math.abs(existing.sizeIn - report.sizeIn) > sizeTolerance
      ) {
        return false;
      }
      return true;
    });

    if (!match) {
      kept.push({
        ...report,
        damageTags: sortDamageTags(report.damageTags ?? []),
      });
      continue;
    }

    match.damageTags = sortDamageTags([...(match.damageTags ?? []), ...(report.damageTags ?? [])]);
    if (report.photoId) {
      kept.push({
        ...report,
        damageTags: sortDamageTags(report.damageTags ?? []),
      });
      continue;
    }
    if (!match.remark && report.remark) match.remark = report.remark;
  }

  kept.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  return kept;
}
