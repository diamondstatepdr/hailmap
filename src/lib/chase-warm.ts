import { computeChase, loadChaseHits } from "@/lib/chase-build";
import { clusterChaseHits } from "@/lib/chase";
import { writeChaseCache } from "@/lib/chase-cache";
import { loadOsmTargets } from "@/lib/honey-osm";

let started = false;
let refreshing = false;
let timer: NodeJS.Timeout | null = null;
const enrichedWeeks = new Set<string>();

function disabled(): boolean {
  return process.env.HAILMAP_CHASE_WARM === "0";
}

async function enrichPlaces(now: Date): Promise<void> {
  const hits = loadChaseHits(now);
  const clusters = [...clusterChaseHits(hits)]
    .sort((a, b) => {
      const hail = (cluster: typeof a) => Math.max(0, ...cluster.hits.map((hit) => Math.max(hit.radarIn ?? 0, hit.spotterIn ?? 0)));
      return hail(b) - hail(a);
    })
    .slice(0, 6);
  for (const cluster of clusters) {
    const hail = Math.max(0, ...cluster.hits.map((hit) => Math.max(hit.radarIn ?? 0, hit.spotterIn ?? 0)));
    if (hail < 1) continue;
    try {
      await loadOsmTargets(cluster.bounds, () => hail);
    } catch (error) {
      console.error("[hailmap] chase enrich", error instanceof Error ? error.message : error);
      break;
    }
  }
}

async function refreshChase(): Promise<void> {
  if (refreshing || disabled()) return;
  refreshing = true;
  try {
    const now = new Date();
    let payload = await computeChase(now);
    if (payload.partial && !enrichedWeeks.has(payload.week)) {
      enrichedWeeks.add(payload.week);
      await enrichPlaces(now);
      payload = await computeChase(now);
    }
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
