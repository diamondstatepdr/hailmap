import { validLatLon } from "@/lib/geo";
import { radarSampleFor } from "@/lib/mesh-cache";
import { planMesh } from "@/lib/mesh-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!validLatLon(lat, lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
  const plan = planMesh({
    hours: url.searchParams.has("hours") ? Number(url.searchParams.get("hours")) : undefined,
    date: url.searchParams.get("date"),
  });
  if ("error" in plan) return Response.json({ error: plan.error }, { status: 400 });
  try {
    const sample = await radarSampleFor(plan, lat, lon);
    return Response.json(sample, { headers: { "Cache-Control": "public, max-age=120" } });
  } catch (error) {
    console.error("[hailmap] mesh sample", error instanceof Error ? error.message : error);
    return Response.json({
      status: "error",
      maxIn: null,
      days: [],
      note: "Radar hail is unavailable right now.",
      label: plan.label,
    });
  }
}
