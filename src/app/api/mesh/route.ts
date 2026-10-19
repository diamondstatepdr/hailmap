import { meshLayerFor } from "@/lib/mesh-cache";
import { planMesh } from "@/lib/mesh-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const plan = planMesh({
    hours: url.searchParams.has("hours") ? Number(url.searchParams.get("hours")) : undefined,
    date: url.searchParams.get("date"),
  });
  if ("error" in plan) return Response.json({ error: plan.error }, { status: 400 });
  try {
    const layer = await meshLayerFor(plan);
    const cache = plan.mode === "days" && plan.dates.length === 1 ? "public, max-age=3600" : "public, max-age=120";
    return Response.json(layer, { headers: { "Cache-Control": cache } });
  } catch (error) {
    console.error("[hailmap] mesh", error instanceof Error ? error.message : error);
    return Response.json(
      {
        status: "error",
        label: plan.label,
        product: plan.product,
        validTime: null,
        note: "Radar hail is unavailable right now.",
        legend: [],
        collection: { type: "FeatureCollection", features: [] },
        bounds: null,
      },
      { status: 200 },
    );
  }
}
