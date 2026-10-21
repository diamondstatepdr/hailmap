import { computeChase } from "@/lib/chase-build";
import { writeChaseCache } from "@/lib/chase-cache";

let started = false;
let refreshing = false;
let timer: NodeJS.Timeout | null = null;

function disabled(): boolean {
  return process.env.HAILMAP_CHASE_WARM === "0";
}

async function refreshChase(): Promise<void> {
  if (refreshing || disabled()) return;
  refreshing = true;
  try {
    const payload = await computeChase(new Date());
    writeChaseCache(payload);
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

/** Precompute the weekly chase list so the first open reads a warm file. */
export function startChaseWarm(): void {
  if (disabled() || started) return;
  started = true;
  scheduleChaseRefresh();
  const interval = setInterval(() => scheduleChaseRefresh(), 3 * 60 * 60 * 1000);
  interval.unref?.();
  console.log("[hailmap] chase list warm started");
}
