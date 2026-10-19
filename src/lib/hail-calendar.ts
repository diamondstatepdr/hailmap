/** Hail-size marks on the month calendar. Thresholds are inches. */

export interface HailCalendarBand {
  id: "under-1" | "1" | "1.75" | "2.5";
  label: string;
  minIn: number;
  color: string;
  /** Dot diameter in pixels. */
  px: number;
}

export const HAIL_CALENDAR_BANDS: readonly HailCalendarBand[] = [
  { id: "under-1", label: "Under 1\"", minIn: 0, color: "#65a30d", px: 8 },
  { id: "1", label: "1\"+", minIn: 1, color: "#ca8a04", px: 12 },
  { id: "1.75", label: "1.75\"+", minIn: 1.75, color: "#ea580c", px: 16 },
  { id: "2.5", label: "2.5\"+", minIn: 2.5, color: "#dc2626", px: 20 },
];

export function hailCalendarBand(inches: number): HailCalendarBand {
  let band: HailCalendarBand = HAIL_CALENDAR_BANDS[0];
  for (const candidate of HAIL_CALENDAR_BANDS) {
    if (inches >= candidate.minIn) band = candidate;
  }
  return band;
}

/** Sunday-first cells for a calendar month. Blanks pad the first and last week. */
export function monthCells(year: number, month: number): Array<string | null> {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: firstDow }, () => null);
  const mm = String(month).padStart(2, "0");
  for (let day = 1; day <= count; day += 1) {
    cells.push(`${year}-${mm}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export const CALENDAR_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;

export const CALENDAR_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
