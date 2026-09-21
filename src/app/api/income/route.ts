import { getIncomeGeoJson, maybeRefreshIncome } from "@/lib/census";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    maybeRefreshIncome();
    const collection = getIncomeGeoJson();
    return Response.json(collection, {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch (error) {
    console.error("[hailmap] income", error instanceof Error ? error.message : error);
    return Response.json({ type: "FeatureCollection", features: [] });
  }
}
