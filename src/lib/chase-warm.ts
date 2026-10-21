import { computeChase } from "@/lib/chase-build";
import { readChaseCache, writeChaseCache } from "@/lib/chase-cache";
import { scheduleHoneyWarm } from "@/lib/honey-warm";
import { STORM_REFRESH_MS, chaseTopChanged, chaseTopKey } from "@/lib/list-freshness";
import { pullNewestHail, writeStormRefresh } from "@/lib/storm-refresh";

let started = false;
let refreshing = false;
let timer: NodeJS.Timeout | null = null;

/** Server interval for a hail pull plus a Money Hole and Chase List rebuild. */
export const CHASE_REFRESH_MS = STORM_REFRESH_MS;

function disabled(): boolean {
  return process.env.HAILMAP_CHASE_WARM === "0";
}

async function refreshChase(): Promise<void> {
  if (refreshing || disabled()) return;
  refreshing = true;
  try {
    await pullNewestHail();
    const previous = readChaseCache();
    const payload = await computeChase(new Date());
    const topChanged = chaseTopChanged(previous, payload);
    writeChaseCache(payload);
    writeStormRefresh({
      refreshedAt: payload.generatedAt,
      topKey: chaseTopKey(payload),
      topChanged,
    });
    scheduleHoneyWarm();
    console.log(`[hailmap] storm refresh ${topChanged ? "chase top 5 changed" : "chase top 5 unchanged"}`);
  } catch (error) {
    console.error("[hailmap] chase", error instanceof Error ? error.message : error);
  } finally {
    refreshing = false;
  }
}

/** Queue one background rebuild. Safe to call from the request path. */
export function scheduleChaseRefresh(): void {
  if (disabled() || refreshing || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void refreshChase();
  }, 1500);
  timer.unref?.();
}

/**
 * Precompute the weekly chase list so the first open reads a warm file.
 * Every 6 hours, pull the newest hail and rebuild the rankings on the server.
 */
export function startChaseWarm(): void {
  if (disabled() || started) return;
  started = true;
  scheduleChaseRefresh();
  const interval = setInterval(() => scheduleChaseRefresh(), CHASE_REFRESH_MS);
  interval.unref?.();
  console.log("[hailmap] chase list warm started");
}
