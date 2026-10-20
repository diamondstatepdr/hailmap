import { TIME_WINDOWS } from "@/lib/filters";
import { MESH_ARCHIVE_START } from "@/lib/history-coverage";

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
  "Radar hail for the last hour. There is no 6-hour radar product, so the 6-hour map uses the last hour.";

const DAY_NOTE =
  "Each date is the 24-hour radar hail maximum ending at 12:00 UTC the next day, covering that afternoon and evening in the United States.";

const ROLLING_NOTE =
  "Rolling radar hail maximum. It estimates hail size where stones fell, not a stone measured at the address.";

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
/** Pick the archive file closest to 12:00 UTC. Early days use irregular timestamps and an MRMS_ prefix. */
export function pickMeshArchiveName(names: string[]): string | null {
  const files = names.filter((name) => /(?:MESH|MRMS)_Max_1440min_00\.50_.*\.grib2\.gz$/i.test(name));
  if (!files.length) return null;
  const score = (name: string) => {
    const match = name.match(/(\d{6})\.grib2\.gz$/i);
    if (!match) return 1e9;
    const hh = Number(match[1].slice(0, 2));
    const mm = Number(match[1].slice(2, 4));
    const ss = Number(match[1].slice(4, 6));
    return Math.abs(hh * 3600 + mm * 60 + ss - 12 * 3600);
  };
  return files.slice().sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0] ?? null;
}

export function meshArchivePage(convectiveDate: string): string {
  const end = addIsoDays(convectiveDate, 1);
  const [year, month, day] = end.split("-");
  return `https://mtarchive.geol.iastate.edu/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/`;
}

export function dayFetchUrls(convectiveDate: string, now = new Date()): string[] {
  const end = addIsoDays(convectiveDate, 1);
  const [year, month, day] = end.split("-");
  const ymd = `${year}${month}${day}`;
  const hours = ["120000", "180000", "060000", "000000"];
  const prefixes = convectiveDate < "2022-10-01" ? ["MRMS_Max_1440min", "MESH_Max_1440min"] : ["MESH_Max_1440min", "MRMS_Max_1440min"];
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const recent = Number.isFinite(endMs) && now.getTime() - endMs < 40 * 3600 * 1000;
  const urls: string[] = [];
  for (const hour of hours) {
    if (recent) {
      urls.push(`https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/MRMS_MESH_Max_1440min_00.50_${ymd}-${hour}.grib2.gz`);
    }
    for (const prefix of prefixes) {
      urls.push(
        `https://mtarchive.geol.iastate.edu/${year}/${month}/${day}/mrms/ncep/MESH_Max_1440min/${prefix}_00.50_${ymd}-${hour}.grib2.gz`,
      );
    }
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
    if (date < MESH_ARCHIVE_START) return { error: "Radar hail swaths in the Iowa State archive start on 2019-09-28." };
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
