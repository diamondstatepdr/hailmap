import { haversineKm } from "@/lib/geo";

/** Houses a tech has knocked. Shared with everyone on the team passcode. */
export const CANVASS_STATUSES = ["knocked", "not_home", "interested", "signed"] as const;
export type CanvassStatus = (typeof CANVASS_STATUSES)[number];

/** Same house if the tap lands within this distance of an existing mark. */
export const CANVASS_MATCH_KM = 0.04;

export const CANVASS_COLORS: Record<CanvassStatus, string> = {
  knocked: "#1d4ed8",
  not_home: "#b45309",
  interested: "#6d28d9",
  signed: "#047857",
};

export interface CanvassStop {
  id: string;
  addressKey: string;
  address: string;
  lat: number;
  lon: number;
  status: CanvassStatus;
  note: string | null;
  hailIn: number | null;
  repId: string;
  repName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CanvassEvent {
  stopId: string;
  repId: string;
  repName: string;
  status: CanvassStatus;
  createdAt: string;
}

export interface CanvassRepCount {
  repId: string;
  repName: string;
  knocked: number;
  notHome: number;
  interested: number;
  signed: number;
  total: number;
}

export function asCanvassStatus(value: unknown): CanvassStatus | null {
  return CANVASS_STATUSES.find((status) => status === value) ?? null;
}

/** Bounds that keep a selected house and the nearby marks on one screen, with room for the hail around them. */
export function canvassFrame(
  selected: { lat: number; lon: number },
  stops: Array<{ lat: number; lon: number }>,
): { west: number; south: number; east: number; north: number } {
  const nearby = stops.filter((stop) => haversineKm(selected.lat, selected.lon, stop.lat, stop.lon) <= 12);
  const group = nearby.length ? nearby : [selected];
  const lats = group.map((stop) => stop.lat);
  const lons = group.map((stop) => stop.lon);
  const latPad = Math.max(0.018, (Math.max(...lats) - Math.min(...lats)) * 0.55);
  const lonPad = Math.max(0.02, (Math.max(...lons) - Math.min(...lons)) * 0.42);
  return {
    west: Math.min(...lons) - lonPad,
    east: Math.max(...lons) + lonPad,
    south: Math.min(...lats) - latPad,
    north: Math.max(...lats) + latPad,
  };
}

export function canvassStatusLabel(status: CanvassStatus): string {
  if (status === "knocked") return "Knocked";
  if (status === "not_home") return "Not home";
  if (status === "interested") return "Interested";
  return "Signed";
}

export function looksLikeCoords(value: string): boolean {
  return /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(value.trim());
}

/** Stable key for a house. A street with no number stays on the porch coordinate. */
export function addressKey(address: string, lat: number, lon: number): string {
  const cleaned = address.trim().replace(/\s+/g, " ");
  const houseNumber = /^\d+\s/.test(cleaned);
  if (!cleaned || !houseNumber || looksLikeCoords(cleaned)) return `geo:${lat.toFixed(4)},${lon.toFixed(4)}`;
  return `addr:${cleaned.toLowerCase()}`;
}

export function clipNote(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.slice(0, 500);
}

export function clipHail(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 8) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Same street address, or the nearest mark within 40 meters.
 * A later tap on the same porch updates that house instead of stacking pins.
 */
export function matchStop<T extends { id: string; addressKey: string; lat: number; lon: number }>(
  stops: T[],
  input: { addressKey: string; lat: number; lon: number },
): T | null {
  const byAddress = stops.find((stop) => stop.addressKey === input.addressKey);
  if (byAddress) return byAddress;
  let best: T | null = null;
  let bestKm = CANVASS_MATCH_KM;
  for (const stop of stops) {
    const km = haversineKm(stop.lat, stop.lon, input.lat, input.lon);
    if (km <= bestKm) {
      best = stop;
      bestKm = km;
    }
  }
  return best;
}

/** Prefer a street address over a coordinate key when both describe one house. */
export function preferAddressKey(current: string, next: string): string {
  if (current.startsWith("geo:") && next.startsWith("addr:")) return next;
  if (current.startsWith("addr:") && next.startsWith("geo:")) return current;
  return next;
}

function offsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const hour = pick("hour") === 24 ? 0 : pick("hour");
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), hour, pick("minute"), pick("second"));
  return asUtc - date.getTime();
}

/** Inclusive local midnight through the next local midnight, as UTC instants. */
export function zonedDayRange(day: string, timeZone: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    return null;
  }
  const [year, month, date] = day.split("-").map(Number);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  const startUtc = Date.UTC(year, month - 1, date, 0, 0, 0);
  const endUtc = Date.UTC(year, month - 1, date + 1, 0, 0, 0);
  const startGuess = new Date(startUtc - offsetMs(new Date(startUtc + 12 * 3600 * 1000), timeZone));
  const start = new Date(startUtc - offsetMs(startGuess, timeZone));
  const endGuess = new Date(endUtc - offsetMs(new Date(start.getTime() + 24 * 3600 * 1000), timeZone));
  const end = new Date(endUtc - offsetMs(endGuess, timeZone));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return { start, end };
}

/**
 * One house counts once per rep, under the last status that rep set.
 * Totals are houses touched, not repeated taps.
 */
export function summarizeReps(events: CanvassEvent[]): CanvassRepCount[] {
  const latest = new Map<string, CanvassEvent>();
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.stopId.localeCompare(b.stopId));
  for (const event of ordered) latest.set(`${event.repId}|${event.stopId}`, event);
  const reps = new Map<string, CanvassRepCount>();
  for (const event of latest.values()) {
    const row = reps.get(event.repId) ?? {
      repId: event.repId,
      repName: event.repName,
      knocked: 0,
      notHome: 0,
      interested: 0,
      signed: 0,
      total: 0,
    };
    row.repName = event.repName;
    if (event.status === "knocked") row.knocked += 1;
    if (event.status === "not_home") row.notHome += 1;
    if (event.status === "interested") row.interested += 1;
    if (event.status === "signed") row.signed += 1;
    row.total += 1;
    reps.set(event.repId, row);
  }
  return [...reps.values()].sort((a, b) => b.total - a.total || a.repName.localeCompare(b.repName));
}
