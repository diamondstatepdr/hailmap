import type { HoneyBounds, HoneySource } from "@/lib/honey";
import type { DamageLevel } from "@/lib/probability";

/** How many areas the weekly pop-up shows before See all. */
export const CHASE_PREVIEW = 5;

export interface ChaseHit {
  lat: number;
  lon: number;
  stormDate: string;
  occurredAt: string | null;
  location: string | null;
  county: string | null;
  state: string | null;
  /** Stone size from a spotter, NWS, or community report. */
  spotterIn: number | null;
  /** MRMS MESH inches at this hit. */
  radarIn: number | null;
  confidence: "nws" | "spotter" | "community" | "mesh";
}

export interface ChaseStop {
  id: string;
  name: string;
  date: string;
  lat: number;
  lon: number;
  bounds: HoneyBounds;
  radarIn: number | null;
  spotterIn: number | null;
  vehicles: number | null;
  homes: number | null;
  score: number;
  raw: number;
  level: DamageLevel;
  source: HoneySource;
  sourceLabel: string;
  density: "measured" | "unknown";
}

export interface ChasePayload {
  version: 3;
  week: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  /** No hail area reached an inch in the last 7 days. */
  quiet: boolean;
  /** True when a candidate area could not be counted yet. Listed rows already have counts. */
  partial: boolean;
  fresh: { pdr: ChaseStop[]; roof: ChaseStop[] };
  fallback: { pdr: ChaseStop[]; roof: ChaseStop[] };
}

export function isoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function chasePopupKey(week: string): string {
  return `hailmap-chase-popup:${week}`;
}

export function chaseViewedKey(week: string): string {
  return `hailmap-chase-viewed:${week}`;
}

/** The weekly pop-up is stored as "1" on its ISO-week key. */
export function shouldShowWeeklyChase(storedValue: string | null): boolean {
  return storedValue !== "1";
}

/** The Storms tab dot stays until this week's list has been opened. */
export function chaseListIsNew(storedValue: string | null): boolean {
  return storedValue !== "1";
}
