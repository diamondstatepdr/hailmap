import { MESH_INSTANT_START } from "@/lib/history-coverage";
import { estimateMeshIndex, meshBudgetBytes, yesterdayIso } from "@/lib/mesh-budget";
import { addIsoDays, isoDateUTC } from "@/lib/mesh-plan";
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
  if (process.env.HAILMAP_MESH_BACKFILL === "0") return;
  const estimate = estimateMeshIndex({
    from: MESH_INSTANT_START,
    to: yesterdayIso(),
    budgetBytes: meshBudgetBytes(),
  });
  console.log(
    `[hailmap] mesh index estimate ${estimate.days} days, about ${estimate.bytes} bytes at ${estimate.cellsPerDay} cells/day. Budget ${estimate.budgetBytes} bytes. Raw GRIB is not kept.`,
  );
  meshTimer = setInterval(() => {
    void backfillOneMeshDay().catch((error) => {
      console.error("[hailmap] mesh backfill", error instanceof Error ? error.message : error);
    });
  }, 20_000);
  meshTimer.unref?.();
}

async function backfillOneMeshDay() {
  const { meshCellTotal, meshDayReady, historyMeta, setHistoryMeta } = await import("@/lib/history-db");
  const today = isoDateUTC(new Date());
  let date = historyMeta("meshBackfillCursor") ?? addIsoDays(today, -1);
  if (date >= today) date = addIsoDays(today, -1);
  if (date < MESH_INSTANT_START) {
    setHistoryMeta("meshBackfillCursor", MESH_INSTANT_START);
    setHistoryMeta("meshBackfillState", "done");
    if (meshTimer) clearInterval(meshTimer);
    meshTimer = null;
    return;
  }
  if (historyMeta("meshBackfillState") === "budget") return;
  if (meshDayReady(date)) {
    setHistoryMeta("meshBackfillCursor", addIsoDays(date, -1));
    return;
  }
  const { indexMeshDay } = await import("@/lib/mesh-cache");
  const indexed = await indexMeshDay(date, { existingCells: meshCellTotal() });
  if (indexed.status === "budget") {
    setHistoryMeta("meshBackfillState", "budget");
    console.log(`[hailmap] mesh backfill stopped at the ${meshBudgetBytes()} byte budget on ${date}`);
    if (meshTimer) clearInterval(meshTimer);
    meshTimer = null;
    return;
  }
  setHistoryMeta("meshBackfillCursor", addIsoDays(date, -1));
}
