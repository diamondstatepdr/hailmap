export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.npm_lifecycle_event === "build") return;
  if (process.env.HAILMAP_ALERTS_DISABLE === "1") return;
  const { startAlertLoop } = await import("@/lib/alert-scheduler");
  startAlertLoop();
}
