import { replayHailDay } from "@/lib/alert-replay";
import { isRadiusMi, isThreshold, US_STATES } from "@/lib/alert-model";
import { validLatLon } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() ?? "";
  const lat = url.searchParams.has("lat") ? Number(url.searchParams.get("lat")) : null;
  const lon = url.searchParams.has("lon") ? Number(url.searchParams.get("lon")) : null;
  const radiusMi = url.searchParams.has("radiusMi") ? Number(url.searchParams.get("radiusMi")) : 25;
  const minSizeIn = url.searchParams.has("minSizeIn") ? Number(url.searchParams.get("minSizeIn")) : 0;
  const state = url.searchParams.get("state")?.trim().toUpperCase() || null;
  if ((lat != null || lon != null) && (lat == null || lon == null || !validLatLon(lat, lon))) {
    return Response.json({ error: "lat and lon are required together" }, { status: 400 });
  }
  if (!isRadiusMi(radiusMi)) return Response.json({ error: "radiusMi must be 5, 10, 25, or 50" }, { status: 400 });
  if (!isThreshold(minSizeIn)) return Response.json({ error: 'minSizeIn must be 0, 1, 1.5, or 2' }, { status: 400 });
  if (state && !US_STATES.some((item) => item.abbr === state)) return Response.json({ error: "Unknown state" }, { status: 400 });
  if (lat == null && !state) return Response.json({ error: "Pass a point, a state, or both" }, { status: 400 });
  try {
    const result = await replayHailDay({ date, lat, lon, radiusMi, state, minSizeIn });
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    return Response.json(result);
  } catch (error) {
    console.error("[hailmap] replay", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not replay that hail day" }, { status: 502 });
  }
}
