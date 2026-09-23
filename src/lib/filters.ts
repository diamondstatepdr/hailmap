import type { FeatureCollection, Point } from "geojson";
import type { Confidence } from "@/lib/confidence";
import type { HailReport } from "@/lib/types";

export interface ReportFilter {
  minSize: number;
  hours: number;
  confidences: Confidence[];
  state: string;
}

/** Last 45 minutes. Distinct from the 1 hour chip, and refreshed faster. */
export const LIVE_WINDOW_HOURS = 0.75;

export const DEFAULT_WINDOW_HOURS = 168;

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export interface TimeWindow {
  hours: number;
  label: string;
  /** Plain phrase for the sheet caption, without a "Last" prefix. */
  detail: string;
  refreshMs: number;
  /** Ask the server to bypass the long sync cache. */
  fresh: boolean;
}

export const TIME_WINDOWS: readonly TimeWindow[] = [
  { hours: LIVE_WINDOW_HOURS, label: "Live", detail: "last 45 minutes", refreshMs: 30_000, fresh: true },
  { hours: 1, label: "1 hour", detail: "last hour", refreshMs: 60_000, fresh: true },
  { hours: 6, label: "6 hours", detail: "last 6 hours", refreshMs: FIVE_MINUTES_MS, fresh: false },
  { hours: 24, label: "24 hours", detail: "last 24 hours", refreshMs: FIVE_MINUTES_MS, fresh: false },
  { hours: 72, label: "3 days", detail: "last 3 days", refreshMs: FIVE_MINUTES_MS, fresh: false },
  { hours: 168, label: "7 days", detail: "last 7 days", refreshMs: FIVE_MINUTES_MS, fresh: false },
];

export function timeWindowFor(hours: number): TimeWindow | undefined {
  return TIME_WINDOWS.find((item) => item.hours === hours);
}

export function refreshIntervalMs(hours: number): number {
  return timeWindowFor(hours)?.refreshMs ?? FIVE_MINUTES_MS;
}

export function wantsFreshSync(hours: number): boolean {
  return timeWindowFor(hours)?.fresh ?? false;
}

export function windowPhrase(hours: number): string {
  const item = timeWindowFor(hours);
  if (!item) return "Selected time";
  if (item.hours === LIVE_WINDOW_HOURS) return `Live · ${item.detail}`;
  return `Last ${item.label.toLowerCase()}`;
}

export function emptyWindowMessage(hours: number): string {
  const item = timeWindowFor(hours);
  if (item?.fresh) return `No hail reports in the ${item.detail} yet.`;
  return "No hail reports in this window.";
}

export function applyReportFilter(reports: HailReport[], filter: ReportFilter, now = Date.now()): HailReport[] {
  const cutoff = now - filter.hours * 3600 * 1000;
  const state = filter.state.trim().toUpperCase();
  return reports.filter((report) => {
    const time = Date.parse(report.occurredAt);
    if (Number.isNaN(time) || time < cutoff) return false;
    if ((report.sizeIn ?? 0) < filter.minSize) return false;
    if (!filter.confidences.includes(report.confidence)) return false;
    if (state && (report.state ?? "").toUpperCase() !== state) return false;
    return true;
  });
}

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** GeoJSON points the map circle layer renders. Coordinates are [lon, lat]. */
export function reportsToPointCollection(reports: HailReport[]): FeatureCollection<Point> {
  return {
    type: "FeatureCollection",
    features: reports.map((report) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [report.lon, report.lat] },
      properties: {
        id: report.id,
        confidence: report.confidence,
        hasPhoto: report.photoUrl ? 1 : 0,
        ...(report.sizeIn != null ? { sizeIn: report.sizeIn } : {}),
      },
    })),
  };
}

export function placeLabel(report: Pick<HailReport, "location" | "county" | "state">): string {
  const parts = [report.location, report.county, report.state].filter((part): part is string => Boolean(part));
  return parts.join(", ") || "Unknown location";
}
