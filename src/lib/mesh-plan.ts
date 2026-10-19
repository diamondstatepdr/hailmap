import { TIME_WINDOWS } from "@/lib/filters";

const WINDOW_HOURS = new Set(TIME_WINDOWS.map((item) => item.hours));

export type MeshMode = "latest-60" | "latest-1440" | "days";

export interface MeshRequestPlan {
  label: string;
  product: "MESH_Max_60min" | "MESH_Max_1440min";
  mode: MeshMode;
  /** Convective dates (YYYY-MM-DD) when mode is "days". */
  dates: string[];
  note: string;
}

export const LATEST_MESH_URL = {
  "60": "https://mrms.ncep.noaa.gov/2D/MESH_Max_60min/MRMS_MESH_Max_60min.latest.grib2.gz",
  "1440": "https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/MRMS_MESH_Max_1440min.latest.grib2.gz",
} as const;

const SHORT_NOTE =
  "MRMS has no 6-hour maximum, so this radar layer is the last hour of MESH.";

const DAY_NOTE =
  "Each date is the 24-hour MRMS MESH maximum ending at 12:00 UTC the next day, so it covers that afternoon and evening in the United States.";

const ROLLING_NOTE =
  "Rolling NOAA MRMS MESH maximum. It estimates hail size aloft, not a stone measured at the address.";

export function isoDateUTC(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function formatStormDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** UTC dates touched by a lookback window, oldest first. */
export function datesCovering(hours: number, now: Date): string[] {
  const start = now.getTime() - hours * 3600 * 1000;
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = isoDateUTC(now);
  const dates: string[] = [];
  while (isoDateUTC(cursor) <= end && dates.length < 10) {
    dates.push(isoDateUTC(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Where to read MESH for a convective date.
 * The file valid at 12:00 UTC on the next calendar day covers the US storm day.
 * Recent hours are tried on NCEP first; older days come from the Iowa State archive.
 */
export function dayFetchUrls(convectiveDate: string, now = new Date()): string[] {
  const end = addIsoDays(convectiveDate, 1);
  const [year, month, day] = end.split("-");
  const ymd = `${year}${month}${day}`;
  const hours = ["120000", "180000", "060000", "000000"];
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const recent = Number.isFinite(endMs) && now.getTime() - endMs < 40 * 3600 * 1000;
  const urls: string[] = [];
  for (const hour of hours) {
    const ncep = `https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/MRMS_MESH_Max_1440min_00.50_${ymd}-${hour}.grib2.gz`;
    const archive = `https://mtarchive.geol.iastate.edu/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/MESH_Max_1440min_00.50_${ymd}-${hour}.grib2.gz`;
    if (recent) urls.push(ncep);
    urls.push(archive);
  }
  return urls;
}

export function planMesh(input: { hours?: number; date?: string | null; now?: Date }): MeshRequestPlan | { error: string } {
  const now = input.now ?? new Date();
  const today = isoDateUTC(now);
  const date = input.date?.trim() || null;
  if (date) {
    if (!isIsoDate(date)) return { error: "date must be YYYY-MM-DD" };
    if (date > today) return { error: "That radar date is in the future." };
    if (date < "2015-01-01") return { error: "Radar hail swaths start in 2015." };
    if (date === today) {
      return {
        label: `Today · ${formatStormDate(date)}`,
        product: "MESH_Max_1440min",
        mode: "latest-1440",
        dates: [],
        note: ROLLING_NOTE,
      };
    }
    return {
      label: formatStormDate(date),
      product: "MESH_Max_1440min",
      mode: "days",
      dates: [date],
      note: DAY_NOTE,
    };
  }

  const hours = input.hours ?? 24;
  if (!WINDOW_HOURS.has(hours)) return { error: "hours must be a map time window" };
  if (hours <= 1) {
    return {
      label: "Last hour",
      product: "MESH_Max_60min",
      mode: "latest-60",
      dates: [],
      note: ROLLING_NOTE,
    };
  }
  if (hours <= 6) {
    return {
      label: "Last hour",
      product: "MESH_Max_60min",
      mode: "latest-60",
      dates: [],
      note: SHORT_NOTE,
    };
  }
  if (hours <= 24) {
    return {
      label: "Last 24 hours",
      product: "MESH_Max_1440min",
      mode: "latest-1440",
      dates: [],
      note: ROLLING_NOTE,
    };
  }
  const dates = datesCovering(hours, now);
  return {
    label: hours <= 72 ? "Last 3 days" : "Last 7 days",
    product: "MESH_Max_1440min",
    mode: "days",
    dates,
    note: DAY_NOTE,
  };
}
