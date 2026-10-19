export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    if (process.env.npm_lifecycle_event === "build") return;
    if (process.env.HAILMAP_ALERTS_DISABLE !== "1") {
      const { startAlertLoop } = await import("@/lib/alert-scheduler");
      startAlertLoop();
    }
    if (process.env.HAILMAP_HISTORY_BACKFILL !== "0") {
      const { startHistoryBackfill } = await import("@/lib/history-backfill");
      startHistoryBackfill();
    }
  }
}
