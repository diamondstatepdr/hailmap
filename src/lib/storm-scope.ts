import type { HailReport } from "@/lib/types";

/** NWS marine zone prefixes. These are water, not a roof or a dealer lot. */
const MARINE_STATES = new Set(["AM", "AN", "GM", "LC", "LE", "LH", "LM", "LO", "LS", "PH", "PK", "PM", "PS", "PZ", "SL"]);

const MARINE_TEXT =
  /\b(waters|offshore|gulf of mexico|gulf of alaska|atlantic ocean|pacific ocean|coastal waters|marine zone|and vicinity)\b/i;

export interface ViewBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function isMarineReport(report: Pick<HailReport, "state" | "location" | "county">): boolean {
  const state = (report.state ?? "").trim().toUpperCase();
  if (MARINE_STATES.has(state)) return true;
  const text = `${report.location ?? ""} ${report.county ?? ""}`;
  return MARINE_TEXT.test(text);
}

export function reportInView(report: Pick<HailReport, "lat" | "lon">, bounds: ViewBox | null): boolean {
  if (!bounds) return true;
  return report.lon >= bounds.west && report.lon <= bounds.east && report.lat >= bounds.south && report.lat <= bounds.north;
}

/** Storms list: current map view, without marine zones. */
export function stormsForList<T extends Pick<HailReport, "state" | "location" | "county" | "lat" | "lon">>(
  reports: T[],
  bounds: ViewBox | null,
): T[] {
  return reports.filter((report) => !isMarineReport(report) && reportInView(report, bounds));
}
