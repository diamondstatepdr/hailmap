import type { Confidence } from "@/lib/confidence";
import { haversineKm } from "@/lib/geo";
import { efRank, hazardOf, type Hazard } from "@/lib/hazard";

/**
 * Damage probability is a documented score, not a trained model.
 *
 * It answers: given official and in-app storm reports near a point, how
 * strongly do those reports suggest property damage is worth a closer look?
 * It is not a roof inspection, an insurance decision, or a forecast.
 *
 * Steps, in order:
 * 1. Keep reports inside the requested radius.
 * 2. Score each report from its hail size, wind speed, or tornado rating.
 * 3. Multiply by distance, recency, and source confidence.
 * 4. Keep the strongest report. Extra nearby reports add a small density bonus.
 * 5. A hail swath that covers the point adds coverage. If no hail report is
 *    inside the radius, the swath's max size is the hail evidence instead.
 * 6. Active warnings are not scored. A county-wide warning is not a
 *    measurement at the address. The card still lists them.
 * 7. Map the 0–100 score to Low, Moderate, High, or Very High.
 *
 * Missing radar (no HAILMAP_MESH_URL) simply contributes no MESH reports.
 */
export const DAMAGE_LEVELS = ["Low", "Moderate", "High", "Very High"] as const;
export type DamageLevel = (typeof DAMAGE_LEVELS)[number];

export interface ScoreReport {
  lat: number;
  lon: number;
  occurredAt: string;
  hazard?: Hazard | null;
  confidence: Confidence;
  sizeIn?: number | null;
  windMph?: number | null;
  efRating?: string | null;
}

export interface SwathEvidence {
  hit: boolean;
  maxSizeIn?: number | null;
}

export interface DamageFactor {
  id: string;
  label: string;
  points: number;
  detail: string;
}

export interface DamageScore {
  score: number;
  level: DamageLevel;
  factors: DamageFactor[];
  summary: string;
}

export interface ScoreOptions {
  lat: number;
  lon: number;
  reports: ScoreReport[];
  radiusKm: number;
  now?: number;
  swath?: SwathEvidence | null;
}

const CONFIDENCE_WEIGHT: Record<Confidence, number> = {
  nws: 1,
  spotter: 0.85,
  mesh: 0.65,
  community: 0.4,
};

export function hailSizePoints(inches: number): number {
  if (inches >= 2.75) return 72;
  if (inches >= 2) return 62;
  if (inches >= 1.75) return 54;
  if (inches >= 1.25) return 44;
  if (inches >= 1) return 34;
  if (inches >= 0.75) return 22;
  if (inches >= 0.5) return 12;
  return 6;
}

export function windSpeedPoints(mph: number): number {
  if (mph >= 90) return 60;
  if (mph >= 75) return 48;
  if (mph >= 65) return 38;
  if (mph >= 58) return 28;
  if (mph >= 45) return 16;
  return 8;
}

export function tornadoPoints(rating: string | null): number {
  const rank = efRank(rating);
  if (rank >= 5) return 90;
  if (rank === 4) return 84;
  if (rank === 3) return 76;
  if (rank === 2) return 64;
  if (rank === 1) return 50;
  if (rank === 0) return rating ? 34 : 0;
  return 0;
}

export function distanceWeight(km: number): number {
  if (km <= 0.5) return 1;
  if (km <= 2) return 0.9;
  if (km <= 5) return 0.75;
  if (km <= 10) return 0.55;
  if (km <= 20) return 0.35;
  return 0.2;
}

export function recencyWeight(hoursAgo: number): number {
  if (hoursAgo <= 3) return 1;
  if (hoursAgo <= 12) return 0.9;
  if (hoursAgo <= 24) return 0.8;
  if (hoursAgo <= 72) return 0.6;
  if (hoursAgo <= 168) return 0.45;
  return 0.3;
}

export function levelForScore(score: number): DamageLevel {
  if (score >= 65) return "Very High";
  if (score >= 40) return "High";
  if (score >= 18) return "Moderate";
  return "Low";
}

export function scoreDamage(options: ScoreOptions): DamageScore {
  const now = options.now ?? Date.now();
  const radiusKm = options.radiusKm;
  const considered = options.reports
    .map((report) => {
      const km = haversineKm(options.lat, options.lon, report.lat, report.lon);
      const hours = (now - Date.parse(report.occurredAt)) / 3600000;
      return { report, km, hours };
    })
    .filter((item) => item.km <= radiusKm && Number.isFinite(item.hours) && item.hours >= -0.25);

  let bestPoints = 0;
  let bestDetail = "";
  let bestLabel = "";
  let bestId = "";
  let bestKm = Infinity;
  let hailInside = false;

  for (const item of considered) {
    const hazard = hazardOf(item.report.hazard);
    let base = 0;
    let label = "";
    if (hazard === "hail" && item.report.sizeIn != null && item.report.sizeIn > 0) {
      base = hailSizePoints(item.report.sizeIn);
      label = `${item.report.sizeIn.toFixed(2)} in hail`;
      hailInside = true;
    } else if (hazard === "wind" && item.report.windMph != null) {
      base = windSpeedPoints(item.report.windMph);
      label = `${item.report.windMph} mph wind`;
    } else if (hazard === "tornado") {
      base = tornadoPoints(item.report.efRating ?? null);
      label = item.report.efRating ? `${item.report.efRating} tornado` : "Tornado report";
    } else if (hazard === "hail") {
      base = 6;
      label = "Hail report, size unknown";
      hailInside = true;
    } else if (hazard === "wind") {
      base = 8;
      label = "Wind report, speed unknown";
    }
    if (!base) continue;
    const points = Math.round(
      base * distanceWeight(item.km) * recencyWeight(Math.max(0, item.hours)) * CONFIDENCE_WEIGHT[item.report.confidence],
    );
    if (points > bestPoints || (points === bestPoints && item.km < bestKm)) {
      bestPoints = points;
      bestKm = item.km;
      bestLabel = label;
      bestId = hazard;
      const confidence =
        item.report.confidence === "nws"
          ? "NWS"
          : item.report.confidence === "spotter"
            ? "spotter"
            : item.report.confidence === "mesh"
              ? "radar MESH"
              : "community";
      bestDetail = `${label}, ${item.km < 0.1 ? "at this point" : `${item.km.toFixed(1)} km away`}, ${confidence}, ${formatHours(item.hours)}.`;
    }
  }

  const factors: DamageFactor[] = [];
  if (bestPoints > 0) {
    factors.push({
      id: bestId || "report",
      label: bestLabel,
      points: bestPoints,
      detail: bestDetail,
    });
  }

  const nearbyDense = considered.filter((item) => item.km <= 10);
  const extra = Math.max(0, nearbyDense.length - (bestPoints > 0 ? 1 : 0));
  let densityPoints = 0;
  if (extra > 0) {
    const weighted = nearbyDense.reduce((sum, item) => {
      const weight = CONFIDENCE_WEIGHT[item.report.confidence];
      return sum + (weight >= 0.65 ? 1 : 0.5);
    }, 0);
    const counted = Math.max(0, weighted - (bestPoints > 0 ? 1 : 0));
    densityPoints = Math.min(12, Math.round(counted * 3));
    if (densityPoints > 0) {
      factors.push({
        id: "density",
        label: "Nearby reports",
        points: densityPoints,
        detail: `${nearbyDense.length} reports within 10 km. Extra reports add confidence, up to 12 points.`,
      });
    }
  }

  let swathPoints = 0;
  if (options.swath?.hit) {
    if (hailInside) {
      swathPoints = 10;
      factors.push({
        id: "swath",
        label: "Hail swath",
        points: swathPoints,
        detail: "This point is inside a hail swath built from clustered reports.",
      });
    } else {
      const size = options.swath.maxSizeIn;
      swathPoints = size != null && size > 0 ? Math.min(40, Math.round(hailSizePoints(size) * 0.55)) : 14;
      factors.push({
        id: "swath",
        label: "Hail swath",
        points: swathPoints,
        detail:
          size != null && size > 0
            ? `No hail report inside ${radiusKm} km, but a swath covers this point (max ${size.toFixed(2)} in nearby).`
            : "A hail swath covers this point, without a sized hail report inside the radius.",
      });
    }
  }

  const score = Math.max(0, Math.min(100, bestPoints + densityPoints + swathPoints));
  const level = levelForScore(score);
  if (!factors.length) {
    factors.push({
      id: "none",
      label: "No reports in range",
      points: 0,
      detail: `No hail, wind, or tornado reports within ${radiusKm} km in this date range.`,
    });
  }

  const summary =
    score === 0
      ? "Low because nothing in this radius and date range supports a damage score. That is not a roof inspection."
      : `${level} (${score}/100) from hail size, wind, tornado rating, distance, source confidence, density, swath coverage, and recency. Not a roof inspection or an insurance determination.`;

  return { score, level, factors, summary };
}

function formatHours(hours: number): string {
  if (hours < 1) return "within the last hour";
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
