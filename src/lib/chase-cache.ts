import fs from "node:fs";
import path from "node:path";
import { isoWeekKey, type ChasePayload } from "@/lib/chase-week";
import { dataDir } from "@/lib/db";

export function chaseCacheFile(): string {
  return path.join(dataDir(), "chase", "week.json");
}

export function readChaseCache(): ChasePayload | null {
  const file = chaseCacheFile();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ChasePayload;
    if (parsed?.version !== 1 || typeof parsed.week !== "string" || !parsed.fresh || !parsed.fallback) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeChaseCache(payload: ChasePayload): void {
  const file = chaseCacheFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload));
  fs.renameSync(temporary, file);
}

/** A cached list is warm when it belongs to the current ISO week. */
export function cachedChase(now = new Date()): ChasePayload | null {
  const payload = readChaseCache();
  if (!payload) return null;
  if (payload.week !== isoWeekKey(now)) return null;
  return payload;
}

const FRESH_MS = 3 * 60 * 60 * 1000;

export function chaseCacheStale(payload: ChasePayload, now = new Date()): boolean {
  const age = now.getTime() - Date.parse(payload.generatedAt);
  return !Number.isFinite(age) || age < 0 || age > FRESH_MS;
}
