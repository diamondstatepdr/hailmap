export const RADIUS_MILES = [5, 10, 25, 50] as const;
export type RadiusMi = (typeof RADIUS_MILES)[number];

export const HAIL_THRESHOLDS = [
  { inches: 0, label: "Any" },
  { inches: 1, label: '1"' },
  { inches: 1.5, label: '1.5"' },
  { inches: 2, label: '2"+' },
] as const;

export type WatchKind = "point" | "state" | "near";
export type AlertKind = "mesh" | "report" | "warning" | "outlook" | "test";

export interface AlertPrefs {
  minSizeIn: number;
  mesh: boolean;
  reports: boolean;
  warnings: boolean;
  outlook: boolean;
}

export const DEFAULT_PREFS: AlertPrefs = {
  minSizeIn: 0,
  mesh: true,
  reports: true,
  warnings: true,
  outlook: false,
};

export const US_STATES: ReadonlyArray<{ abbr: string; name: string }> = [
  { abbr: "AL", name: "Alabama" },
  { abbr: "AK", name: "Alaska" },
  { abbr: "AZ", name: "Arizona" },
  { abbr: "AR", name: "Arkansas" },
  { abbr: "CA", name: "California" },
  { abbr: "CO", name: "Colorado" },
  { abbr: "CT", name: "Connecticut" },
  { abbr: "DE", name: "Delaware" },
  { abbr: "DC", name: "District of Columbia" },
  { abbr: "FL", name: "Florida" },
  { abbr: "GA", name: "Georgia" },
  { abbr: "HI", name: "Hawaii" },
  { abbr: "ID", name: "Idaho" },
  { abbr: "IL", name: "Illinois" },
  { abbr: "IN", name: "Indiana" },
  { abbr: "IA", name: "Iowa" },
  { abbr: "KS", name: "Kansas" },
  { abbr: "KY", name: "Kentucky" },
  { abbr: "LA", name: "Louisiana" },
  { abbr: "ME", name: "Maine" },
  { abbr: "MD", name: "Maryland" },
  { abbr: "MA", name: "Massachusetts" },
  { abbr: "MI", name: "Michigan" },
  { abbr: "MN", name: "Minnesota" },
  { abbr: "MS", name: "Mississippi" },
  { abbr: "MO", name: "Missouri" },
  { abbr: "MT", name: "Montana" },
  { abbr: "NE", name: "Nebraska" },
  { abbr: "NV", name: "Nevada" },
  { abbr: "NH", name: "New Hampshire" },
  { abbr: "NJ", name: "New Jersey" },
  { abbr: "NM", name: "New Mexico" },
  { abbr: "NY", name: "New York" },
  { abbr: "NC", name: "North Carolina" },
  { abbr: "ND", name: "North Dakota" },
  { abbr: "OH", name: "Ohio" },
  { abbr: "OK", name: "Oklahoma" },
  { abbr: "OR", name: "Oregon" },
  { abbr: "PA", name: "Pennsylvania" },
  { abbr: "RI", name: "Rhode Island" },
  { abbr: "SC", name: "South Carolina" },
  { abbr: "SD", name: "South Dakota" },
  { abbr: "TN", name: "Tennessee" },
  { abbr: "TX", name: "Texas" },
  { abbr: "UT", name: "Utah" },
  { abbr: "VT", name: "Vermont" },
  { abbr: "VA", name: "Virginia" },
  { abbr: "WA", name: "Washington" },
  { abbr: "WV", name: "West Virginia" },
  { abbr: "WI", name: "Wisconsin" },
  { abbr: "WY", name: "Wyoming" },
];

export const MILES_TO_KM = 1.609344;

export function isRadiusMi(value: number): value is RadiusMi {
  return (RADIUS_MILES as readonly number[]).includes(value);
}

export function isThreshold(value: number): boolean {
  return HAIL_THRESHOLDS.some((item) => item.inches === value);
}

export function stateName(abbr: string): string {
  return US_STATES.find((item) => item.abbr === abbr.toUpperCase())?.name ?? abbr;
}

export function formatInches(size: number): string {
  const rounded = Math.round(size * 100) / 100;
  return `${rounded.toFixed(2).replace(/\.?0+$/, "")}"`;
}

/** Snap a coordinate to a storm-cell bucket. 0.5° is about 35 miles. */
export function bucketCoord(value: number, step = 0.5): number {
  return Math.round(value / step) * step;
}

export function formatAlertClock(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const zones = [timeZone, "America/Chicago", "UTC"];
  for (const zone of zones) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    } catch {
      /* try the next zone */
    }
  }
  return "";
}

export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Friendly US name for a phone zone, such as "Central" for America/Chicago. */
export function timeZoneName(timeZone: string | null | undefined): string {
  if (!timeZone) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date());
    const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    const name = raw.replace(/\s+(Standard|Daylight)\s+Time$/, "").replace(/\s+Time$/, "").trim();
    if (!name || /^GMT/i.test(name)) return timeZone === "UTC" || timeZone === "Etc/UTC" || timeZone === "Etc/GMT" ? "UTC" : name;
    return name;
  } catch {
    return "";
  }
}

export function isIanaTimeZone(value: string | null | undefined): value is string {
  if (!value || !value.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export function inQuietHours(now: Date, start: string | null, end: string | null, timeZone: string): boolean {
  const startMin = parseClock(start);
  const endMin = parseClock(end);
  if (startMin == null || endMin == null || startMin === endMin) return false;
  const minutes = minutesInZone(now, timeZone);
  if (minutes == null) return false;
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

export interface AlertLinkTarget {
  focus: { lat: number; lon: number; zoom: number } | null;
  reportId: string | null;
  card: { lat: number; lon: number; label: string } | null;
  section: "alerts" | null;
}

function finiteParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseAlertLink(href: string): AlertLinkTarget {
  const url = new URL(href, "http://localhost");
  const params = url.searchParams;
  const lat = finiteParam(params.get("focusLat"));
  const lon = finiteParam(params.get("focusLon"));
  const zoom = finiteParam(params.get("focusZoom"));
  const cardLat = finiteParam(params.get("cardLat"));
  const cardLon = finiteParam(params.get("cardLon"));
  const focus = lat != null && lon != null ? { lat, lon, zoom: zoom ?? 9 } : null;
  const card =
    params.get("card") === "address" && cardLat != null && cardLon != null
      ? { lat: cardLat, lon: cardLon, label: params.get("cardLabel") || "Watched address" }
      : null;
  return {
    focus,
    reportId: params.get("reportId"),
    card,
    section: params.get("section") === "alerts" ? "alerts" : null,
  };
}

function minutesInZone(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    let hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour === 24) hour = 0;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}
