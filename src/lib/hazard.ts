export const HAZARDS = ["hail", "wind", "tornado"] as const;
export type Hazard = (typeof HAZARDS)[number];

export function asHazard(value: unknown): Hazard | null {
  if (value === "hail" || value === "wind" || value === "tornado") return value;
  return null;
}

export function hazardOf(value: unknown): Hazard {
  return asHazard(value) ?? "hail";
}

export function hazardLabel(hazard: Hazard): string {
  if (hazard === "wind") return "Wind";
  if (hazard === "tornado") return "Tornado";
  return "Hail";
}

/** Official local-storm-report wind speed, in miles per hour. */
export function parseWindMph(value: unknown, unit?: string | null): number | null {
  let numeric: number | null = null;
  let unitText = unit ?? "";
  if (typeof value === "number" && Number.isFinite(value)) {
    numeric = value;
  } else if (value != null) {
    const text = String(value).trim();
    if (!text || /^unk/i.test(text)) return null;
    const match = text.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    numeric = Number(match[1]);
    if (!unitText && /\b(knots?|kts?)\b/i.test(text)) unitText = "KT";
  }
  if (numeric == null || !Number.isFinite(numeric) || numeric <= 0 || numeric > 350) return null;
  const mph = /\b(knots?|kts?|kt)\b/i.test(unitText) ? numeric * 1.15078 : numeric;
  return Math.round(mph);
}

/** EF rating from an LSR token such as EF1, F2, EFU, or UNK. */
export function parseEfRating(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;
  const enhanced = text.match(/\bEF\s*([0-5]|U)\b/);
  if (enhanced) return enhanced[1] === "U" ? "EFU" : `EF${enhanced[1]}`;
  const fujita = text.match(/\bF\s*([0-5])\b/);
  if (fujita) return `EF${fujita[1]}`;
  if (text === "UNK" || text === "UNKNOWN") return "UNK";
  return null;
}

export function efRank(rating: string | null | undefined): number {
  if (!rating) return -1;
  if (rating === "EFU" || rating === "UNK") return 0;
  const match = rating.match(/^EF([0-5])$/);
  return match ? Number(match[1]) : -1;
}

export function magnitudeLabel(report: {
  hazard?: Hazard | null;
  sizeIn?: number | null;
  windMph?: number | null;
  efRating?: string | null;
}): string {
  const hazard = hazardOf(report.hazard);
  if (hazard === "wind") return report.windMph != null ? `${report.windMph} mph` : "Speed unknown";
  if (hazard === "tornado") return report.efRating ?? "Rating unknown";
  return report.sizeIn != null ? `${report.sizeIn.toFixed(2)} in` : "Size unknown";
}
