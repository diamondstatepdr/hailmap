import { createHash } from "node:crypto";
import { takeActionSlot } from "@/lib/accounts";
import { validLatLon } from "@/lib/geo";
import { findKnockRoute } from "@/lib/knock-route-osm";
import type { HailBand } from "@/lib/knock-route";
import { clientIp } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asGeometry(value: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as GeoJSON.Geometry;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
  if (JSON.stringify(geometry.coordinates).length > 400000) return null;
  return geometry;
}

function asBands(value: unknown): HailBand[] {
  if (!Array.isArray(value)) return [];
  const bands: HailBand[] = [];
  for (const item of value.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const row = item as { minIn?: unknown; geometry?: unknown };
    const minIn = Number(row.minIn);
    const geometry = asGeometry(row.geometry);
    if (!Number.isFinite(minIn) || minIn <= 0 || minIn > 8 || !geometry) continue;
    bands.push({ minIn, geometry });
  }
  return bands;
}

export async function POST(request: Request) {
  const hash = createHash("sha256").update(`knock-route|${clientIp(request)}`).digest("hex");
  const slot = takeActionSlot(hash, "knock-route", 20, 3600000);
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const geometry = asGeometry(record.geometry);
  if (!geometry) return Response.json({ error: "A hail swath polygon is required" }, { status: 400 });
  const focusRaw = record.focus && typeof record.focus === "object" ? (record.focus as Record<string, unknown>) : {};
  const lat = Number(focusRaw.lat);
  const lon = Number(focusRaw.lon);
  if (!validLatLon(lat, lon)) return Response.json({ error: "A starting point is required" }, { status: 400 });
  const fallback = Number(record.fallbackHail);
  try {
    const result = await findKnockRoute({
      geometry,
      focus: { lat, lon },
      bands: asBands(record.bands),
      fallbackHail: Number.isFinite(fallback) ? fallback : 0.75,
    });
    return Response.json(
      { stops: result.stops, note: result.note, attribution: "Streets © OpenStreetMap contributors" },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build that route";
    const status = /outline/i.test(message) ? 400 : 502;
    return Response.json({ error: message, stops: [] }, { status });
  }
}
