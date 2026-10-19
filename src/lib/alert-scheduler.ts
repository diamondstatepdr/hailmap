import { alertIntervalMs, rememberAlertError, runAlertCycle } from "@/lib/alert-engine";
import { getVapid } from "@/lib/vapid";

const globalForAlerts = globalThis as unknown as { hailAlertLoop?: boolean };

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await runAlertCycle();
  } catch (error) {
    console.error("[hailmap] alerts", error instanceof Error ? error.message : error);
    rememberAlertError(error);
  } finally {
    running = false;
  }
}

/** Check watch areas every few minutes. Safe to call more than once per process. */
export function startAlertLoop() {
  if (globalForAlerts.hailAlertLoop) return;
  globalForAlerts.hailAlertLoop = true;
  getVapid();
  const interval = alertIntervalMs();
  const timer = setInterval(() => void tick(), interval);
  timer.unref?.();
  const kick = setTimeout(() => void tick(), 20_000);
  kick.unref?.();
  console.log(`[hailmap] alert loop every ${Math.round(interval / 1000)}s`);
}
