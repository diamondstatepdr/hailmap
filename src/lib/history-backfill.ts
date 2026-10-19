import { isoDateUTC } from "@/lib/mesh-plan";
import { ensureHistoryIndex, startDailyTail } from "@/lib/spc-archive";

let started = false;
let meshTimer: NodeJS.Timeout | null = null;

export function startHistoryBackfill() {
  if (started) return;
  started = true;
  void ensureHistoryIndex()
    .then(() => startDailyTail())
    .catch((error) => {
      console.error("[hailmap] history index", error instanceof Error ? error.message : error);
    });
  if (process.env.HAILMAP_MESH_BACKFILL === "1") {
    meshTimer = setInterval(() => {
      void backfillOneMeshDay().catch((error) => {
        console.error("[hailmap] mesh backfill", error instanceof Error ? error.message : error);
      });
    }, 20_000);
    meshTimer.unref?.();
  }
}

async function backfillOneMeshDay() {
  const { meshDayReady, historyMeta, setHistoryMeta } = await import("@/lib/history-db");
  const { MESH_ARCHIVE_START } = await import("@/lib/history-coverage");
  const { addIsoDays } = await import("@/lib/mesh-plan");
  const cursor = historyMeta("meshBackfillCursor") ?? isoDateUTC(new Date());
  let date = cursor;
  if (date < MESH_ARCHIVE_START) {
    setHistoryMeta("meshBackfillCursor", MESH_ARCHIVE_START);
    return;
  }
  const today = isoDateUTC(new Date());
  if (date >= today) date = addIsoDays(today, -2);
  if (meshDayReady(date)) {
    setHistoryMeta("meshBackfillCursor", addIsoDays(date, -1));
    return;
  }
  const { planMesh } = await import("@/lib/mesh-plan");
  const { loadPlanGrids } = await import("@/lib/mesh-cache");
  const plan = planMesh({ date });
  if ("error" in plan) {
    setHistoryMeta("meshBackfillCursor", addIsoDays(date, -1));
    return;
  }
  await loadPlanGrids(plan);
  setHistoryMeta("meshBackfillCursor", addIsoDays(date, -1));
}
