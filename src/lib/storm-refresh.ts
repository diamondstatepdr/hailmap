import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";

export {
  STORM_REFRESH_MS,
  chaseDotUnseen,
  chaseTopChanged,
  chaseTopIds,
  chaseTopKey,
  stormRefreshDue,
  updatedAgoLabel,
} from "@/lib/list-freshness";

export interface StormRefreshStatus {
  refreshedAt: string;
  topKey: string;
  topChanged: boolean;
}

export function stormRefreshFile(): string {
  return path.join(dataDir(), "chase", "refresh.json");
}

export function readStormRefresh(): StormRefreshStatus | null {
  const file = stormRefreshFile();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as StormRefreshStatus;
    if (!parsed || typeof parsed.refreshedAt !== "string" || typeof parsed.topKey !== "string") return null;
    return { refreshedAt: parsed.refreshedAt, topKey: parsed.topKey, topChanged: parsed.topChanged === true };
  } catch {
    return null;
  }
}

export function writeStormRefresh(status: StormRefreshStatus): void {
  const file = stormRefreshFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(status));
  fs.renameSync(temporary, file);
}

/** Live reports, the newest SPC days, and the latest radar files. Failures are logged and skipped. */
export async function pullNewestHail(now = new Date()): Promise<void> {
  const { ensureFresh } = await import("@/lib/ingest");
  await ensureFresh(0).catch((error: unknown) => {
    console.error("[hailmap] storm refresh live", error instanceof Error ? error.message : error);
  });
  const { ensureDaily } = await import("@/lib/spc-archive");
  const { addIsoDays, isoDateUTC, planMesh } = await import("@/lib/mesh-plan");
  const today = isoDateUTC(now);
  const yesterday = addIsoDays(today, -1);
  await Promise.all(
    [today, yesterday].map((date) =>
      ensureDaily(date, now).catch((error: unknown) => {
        console.error("[hailmap] storm refresh daily", date, error instanceof Error ? error.message : error);
      }),
    ),
  );
  const { loadPlanGrids } = await import("@/lib/mesh-cache");
  const plans = [planMesh({ hours: 24, now }), planMesh({ date: yesterday, now })];
  for (const plan of plans) {
    if ("error" in plan) continue;
    await loadPlanGrids(plan, now).catch((error: unknown) => {
      console.error("[hailmap] storm refresh mesh", error instanceof Error ? error.message : error);
    });
  }
}
