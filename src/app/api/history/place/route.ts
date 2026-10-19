import { validLatLon } from "@/lib/geo";
import { buildAddressHistory } from "@/lib/history-place";
import { lastYears, parseSpan } from "@/lib/history-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!validLatLon(lat, lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
  const radiusKm = Number(url.searchParams.get("radiusKm") ?? "15");
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 80) {
    return Response.json({ error: "radiusKm must be between 1 and 80" }, { status: 400 });
  }
  const years = Number(url.searchParams.get("years") ?? "");
  const span = url.searchParams.has("start")
    ? parseSpan(url.searchParams.get("start"), url.searchParams.get("end"))
    : lastYears(Number.isFinite(years) && years > 0 ? Math.min(years, 80) : 2);
  if ("error" in span) return Response.json({ error: span.error }, { status: 400 });
  try {
    const history = await buildAddressHistory({
      lat,
      lon,
      radiusKm,
      span,
      scoreDate: url.searchParams.get("scoreDate"),
    });
    return Response.json(history, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[hailmap] history place", error instanceof Error ? error.message : error);
    return Response.json({ error: "Address history is unavailable right now." }, { status: 500 });
  }
}
