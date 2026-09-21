import type { Confidence } from "@/lib/confidence";
import type { HailReport } from "@/lib/types";

export interface ReportFilter {
  minSize: number;
  hours: number;
  confidences: Confidence[];
  state: string;
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

export function placeLabel(report: Pick<HailReport, "location" | "county" | "state">): string {
  const parts = [report.location, report.county, report.state].filter((part): part is string => Boolean(part));
  return parts.join(", ") || "Unknown location";
}
