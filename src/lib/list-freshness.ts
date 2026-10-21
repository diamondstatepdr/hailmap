import { CHASE_PREVIEW, type ChasePayload } from "@/lib/chase-week";

/**
 * How often the server rebuilds Money Hole rankings and the Chase List.
 * Older chase warmups ran every 3 hours and only re-ranked hail already on disk.
 */
export const STORM_REFRESH_MS = 6 * 60 * 60 * 1000;

export function stormRefreshDue(refreshedAt: string | null, now: Date, intervalMs = STORM_REFRESH_MS): boolean {
  if (!refreshedAt) return true;
  const at = Date.parse(refreshedAt);
  if (!Number.isFinite(at)) return true;
  const age = now.getTime() - at;
  if (age < 0) return false;
  return age >= intervalMs;
}

function listedStops(payload: ChasePayload, mode: "pdr" | "roof") {
  return payload.quiet ? payload.fallback[mode] : payload.fresh[mode];
}

/** Ordered ids of the Chase List preview. Scores are left out so a 6-hour rebuild does not count as new. */
export function chaseTopIds(payload: ChasePayload, mode: "pdr" | "roof"): string[] {
  return listedStops(payload, mode)
    .slice(0, CHASE_PREVIEW)
    .map((stop) => stop.id);
}

export function chaseTopKey(payload: ChasePayload): string {
  return [
    payload.week,
    payload.quiet ? "quiet" : "fresh",
    chaseTopIds(payload, "pdr").join(">"),
    chaseTopIds(payload, "roof").join(">"),
  ].join("|");
}

export function chaseTopChanged(previous: ChasePayload | null, next: ChasePayload): boolean {
  if (!previous) return true;
  if (previous.week !== next.week) return true;
  return chaseTopKey(previous) !== chaseTopKey(next);
}

/**
 * The red dot is for a top-5 the tech has not opened.
 * "1" is the older viewed flag from before fingerprints existed.
 */
export function chaseDotUnseen(stored: string | null, topKey: string): boolean {
  if (!stored) return true;
  if (stored === "1") return false;
  return stored !== topKey;
}

/** "Updated 2 h ago", or "Updated just now" inside the first hour. */
export function updatedAgoLabel(at: string | null | undefined, now = new Date()): string | null {
  if (!at) return null;
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return null;
  const age = now.getTime() - parsed;
  if (age < 0) return "Updated just now";
  const hours = Math.floor(age / 3_600_000);
  if (hours < 1) return "Updated just now";
  return `Updated ${hours} h ago`;
}
