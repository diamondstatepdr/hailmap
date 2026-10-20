import { TIME_WINDOWS } from "@/lib/filters";
import { validLatLon } from "@/lib/geo";
import { buildHoney } from "@/lib/honey-rank";
import { isIsoDate } from "@/lib/mesh-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_HOURS = new Set(TIME_WINDOWS.map((item) => item.hours));

function numberParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() || null;
  const hours = numberParam(url.searchParams.get("hours"));
  if (date && !isIsoDate(date)) return Response.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if (!date && (hours == null || !WINDOW_HOURS.has(hours))) {
    return Response.json({ error: "Pick a storm day or a live time window." }, { status: 400 });
  }
  const west = numberParam(url.searchParams.get("west"));
  const south = numberParam(url.searchParams.get("south"));
  const east = numberParam(url.searchParams.get("east"));
  const north = numberParam(url.searchParams.get("north"));
  if (west == null || south == null || east == null || north == null || south >= north || west >= east) {
    return Response.json({ error: "west, south, east, and north are required" }, { status: 400 });
  }
  const lat = numberParam(url.searchParams.get("lat"));
  const lon = numberParam(url.searchParams.get("lon"));
  const origin = lat != null && lon != null && validLatLon(lat, lon) ? { lat, lon } : null;
  try {
    const payload = await buildHoney({
      date,
      hours: date ? null : hours,
      bounds: { west, south, east, north },
      origin,
    });
    const cache = payload.partial || payload.live ? "no-store" : "public, max-age=300";
    return Response.json(payload, { headers: { "Cache-Control": cache } });
  } catch (error) {
    console.error("[hailmap] honey", error instanceof Error ? error.message : error);
    return Response.json({ error: "Money holes are unavailable right now." }, { status: 502 });
  }
}
