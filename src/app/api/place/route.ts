import { getMapReports } from "@/lib/ingest";
import { getLiveThreats } from "@/lib/live-threats";
import { buildPlaceHistory } from "@/lib/place";
import { validLatLon } from "@/lib/geo";
import { TIME_WINDOWS } from "@/lib/filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_HOURS = new Set(TIME_WINDOWS.map((item) => item.hours));

export function parsePlaceQuery(url: URL): { lat: number; lon: number; radiusKm: number; hours: number } | { error: string } {
  const latText = url.searchParams.get("lat");
  const lonText = url.searchParams.get("lon");
  if (latText == null || lonText == null || latText === "" || lonText === "") {
    return { error: "lat and lon are required" };
  }
  const lat = Number(latText);
  const lon = Number(lonText);
  if (!validLatLon(lat, lon)) return { error: "lat and lon are required" };
  const radius = Number(url.searchParams.get("radiusKm") ?? "15");
  if (!Number.isFinite(radius) || radius < 1 || radius > 80) return { error: "radiusKm must be between 1 and 80" };
  const hours = Number(url.searchParams.get("hours") ?? "168");
  if (!WINDOW_HOURS.has(hours)) return { error: "hours must be a map time window" };
  return { lat, lon, radiusKm: radius, hours };
}

export async function GET(request: Request) {
  const parsed = parsePlaceQuery(new URL(request.url));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const [reports, threats] = await Promise.all([
      getMapReports({ fresh: parsed.hours <= 1 }),
      getLiveThreats().catch(() => null),
    ]);
    const history = buildPlaceHistory({
      lat: parsed.lat,
      lon: parsed.lon,
      radiusKm: parsed.radiusKm,
      hours: parsed.hours,
      reports: reports.reports,
      warnings: threats?.collection ?? null,
      warningStatus: threats && threats.status.nws !== "error" ? "ok" : "unavailable",
    });
    return Response.json(
      { ...history, mesh: reports.sourceStatus?.mesh ?? null, syncedAt: reports.syncedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[hailmap] place", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not build a property history" }, { status: 500 });
  }
}
