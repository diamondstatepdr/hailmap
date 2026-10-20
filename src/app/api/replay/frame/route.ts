import { replayRadarFrame } from "@/lib/replay-archive";
import { parseReplayQuery } from "@/lib/replay-time";
import { isIsoDate } from "@/lib/mesh-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = parseReplayQuery(url.searchParams);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const at = url.searchParams.get("at")?.trim() ?? "";
  if (!isIsoDate(at.slice(0, 10)) || Number.isNaN(Date.parse(at))) {
    return Response.json({ error: "at must be an ISO time" }, { status: 400 });
  }
  try {
    const frame = await replayRadarFrame({ date: parsed.date, at, bounds: parsed.bounds });
    const closed = Date.parse(at) < Date.now() - 36 * 3600 * 1000;
    return Response.json(frame, {
      headers: { "Cache-Control": closed && frame.status !== "error" ? "public, max-age=86400" : "public, max-age=120" },
    });
  } catch (error) {
    console.error("[hailmap] replay frame", error instanceof Error ? error.message : error);
    return Response.json(
      {
        at,
        status: "error",
        note: "That radar scan could not be read.",
        validTime: null,
        pulseTime: null,
        collection: { type: "FeatureCollection", features: [] },
        pulse: { type: "FeatureCollection", features: [] },
      },
      { status: 200 },
    );
  }
}
