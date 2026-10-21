import type { DealerPin } from "@/lib/area-selection";
import { findDealers } from "@/lib/dealers";
import { validLatLon } from "@/lib/geo";
import { meshAtPoints } from "@/lib/mesh-cache";
import { planMesh } from "@/lib/mesh-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asGeometry(value: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as GeoJSON.Geometry;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return null;
  const encoded = JSON.stringify(geometry.coordinates);
  if (encoded.length > 400000) return null;
  return geometry;
}

/** Heavier hail is punched out of the parent ring. Lots in those cores are still in the swath. */
function outerOnly(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0];
    return { type: "Polygon", coordinates: ring ? [ring] : [] };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.flatMap((polygon) => (polygon[0] ? [[polygon[0]]] : [])),
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const geometry = asGeometry(record.geometry);
  if (!geometry) return Response.json({ error: "A hail swath polygon is required" }, { status: 400 });
  const nearRaw = record.near && typeof record.near === "object" ? (record.near as Record<string, unknown>) : null;
  const near =
    nearRaw && validLatLon(Number(nearRaw.lat), Number(nearRaw.lon))
      ? { lat: Number(nearRaw.lat), lon: Number(nearRaw.lon) }
      : null;
  try {
    const result = await findDealers({ geometry: outerOnly(geometry), near });
    let mesh: Array<number | null> = [];
    const date = typeof record.date === "string" ? record.date : null;
    if (date && result.dealers.length) {
      const plan = planMesh({ date });
      if (!("error" in plan)) {
        try {
          mesh = await meshAtPoints(plan, result.dealers);
        } catch (error) {
          console.error("[hailmap] dealer mesh", error instanceof Error ? error.message : error);
        }
      }
    }
    const dealers: DealerPin[] = result.dealers.map((dealer, index) => ({ ...dealer, meshIn: mesh[index] ?? null }));
    return Response.json(
      { dealers, note: result.note, attribution: "© OpenStreetMap contributors" },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not search dealerships";
    const status = /smaller|outline/i.test(message) ? 400 : 502;
    return Response.json({ error: message, dealers: [] }, { status });
  }
}
