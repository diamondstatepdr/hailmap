import { addIsoDays, isIsoDate, isoDateUTC } from "@/lib/mesh-plan";
import { SPC_TORNADO_START } from "@/lib/history-coverage";

export interface DateSpan {
  start: string;
  end: string;
}

export const HISTORY_CHIPS: ReadonlyArray<{ id: "30" | "90" | "365"; days: number; label: string }> = [
  { id: "30", days: 30, label: "30 days" },
  { id: "90", days: 90, label: "90 days" },
  { id: "365", days: 365, label: "1 year" },
];

export const ADDRESS_SPANS: ReadonlyArray<{ id: string; years: number | null; label: string }> = [
  { id: "1y", years: 1, label: "1 year" },
  { id: "2y", years: 2, label: "2 years" },
  { id: "5y", years: 5, label: "5 years" },
  { id: "10y", years: 10, label: "10 years" },
  { id: "max", years: null, label: "All" },
];

export function todayIso(now = new Date()): string {
  return isoDateUTC(now);
}

/** Inclusive calendar span ending today. `days` is the number of dates. */
export function lastDays(days: number, now = new Date()): DateSpan {
  const end = todayIso(now);
  const start = addIsoDays(end, -(Math.max(1, Math.round(days)) - 1));
  return { start, end };
}

export function lastYears(years: number, now = new Date()): DateSpan {
  const end = todayIso(now);
  const start = addIsoDays(end, -Math.round(years * 365));
  return clampSpan({ start, end }, now);
}

export function maxReportSpan(now = new Date()): DateSpan {
  return { start: SPC_TORNADO_START, end: todayIso(now) };
}

export function clampSpan(span: DateSpan, now = new Date()): DateSpan {
  const endCap = todayIso(now);
  let start = span.start < SPC_TORNADO_START ? SPC_TORNADO_START : span.start;
  let end = span.end > endCap ? endCap : span.end;
  if (start > end) start = end;
  return { start, end };
}

export function parseSpan(start: string | null, end: string | null, now = new Date()): DateSpan | { error: string } {
  if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) return { error: "start and end must be YYYY-MM-DD" };
  if (start > end) return { error: "The start date is after the end date." };
  if (end > todayIso(now)) return { error: "The end date is in the future." };
  if (start < SPC_TORNADO_START) return { error: "Storm reports in this archive start in 1950." };
  return { start, end };
}

export function spanLabel(span: DateSpan): string {
  return `${formatDay(span.start)} – ${formatDay(span.end)}`;
}

export function formatDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function daysInSpan(span: DateSpan): number {
  const start = Date.parse(`${span.start}T00:00:00Z`);
  const end = Date.parse(`${span.end}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86400000) + 1;
}
