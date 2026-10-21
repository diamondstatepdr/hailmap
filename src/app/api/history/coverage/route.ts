import {
  HISTORY_COVERAGE_CHECKED,
  IEM_LSR_START,
  MESH_ARCHIVE_START,
  MESH_AWS_START,
  MESH_INSTANT_START,
  SBW_POLYGON_START,
  SPC_DAILY_START,
  SPC_HAIL_WIND_START,
  SPC_TORNADO_START,
  VTEC_POINT_START,
} from "@/lib/history-coverage";
import { estimateMeshIndex, meshBudgetBytes, yesterdayIso } from "@/lib/mesh-budget";
import { directoryBytes, historyDir, indexSummary } from "@/lib/history-db";
import { ensureHistoryIndex } from "@/lib/spc-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const build = new URL(request.url).searchParams.get("build") === "1";
  try {
    if (build) await ensureHistoryIndex();
    const index = indexSummary();
    const bytes = directoryBytes(historyDir());
    return Response.json({
      checked: HISTORY_COVERAGE_CHECKED,
      sources: {
        spcHailWind: { start: SPC_HAIL_WIND_START, note: "SPC severe weather database. Hail and wind begin in 1955." },
        spcTornado: { start: SPC_TORNADO_START, note: "SPC tornado database, one row per tornado." },
        spcDaily: { start: SPC_DAILY_START, note: "Daily SPC LSR files fill the year not yet in the annual database." },
        iemLsr: { start: IEM_LSR_START, note: "IEM local storm reports. A single response is capped at 10,000 features. Used for the live 7-day map." },
        mesh: {
          start: MESH_ARCHIVE_START,
          hourlyStart: MESH_INSTANT_START,
          awsStart: MESH_AWS_START,
          note: "Iowa State 24-hour MESH maximum from 2019-09-28. Hourly MESH sample from 2019-08-20 through 2019-09-27. No free nationwide MESH before 2019-08-20. AWS Open Data starts 2020-10-14.",
        },
        warnings: { start: VTEC_POINT_START, note: "IEM warning-by-point archive. A Dallas severe thunderstorm warning was returned for 1986-02-05." },
        sbw: { start: SBW_POLYGON_START, note: "IEM storm-based warning polygons. Present in January 2002. Operational NWS storm-based warnings began 2007-10-01." },
      },
      index,
      diskBytes: bytes,
      meshEstimate: estimateMeshIndex({ from: MESH_INSTANT_START, to: yesterdayIso(), budgetBytes: meshBudgetBytes() }),
    });
  } catch (error) {
    console.error("[hailmap] history coverage", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not read storm-history coverage." }, { status: 500 });
  }
}
