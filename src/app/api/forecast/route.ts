import { loadForecastExposure } from "@/lib/forecast-exposure";
import { parseForecastQuery } from "@/lib/forecast";
import { ESTIMATE_BADGE, ESTIMATE_GUIDE, ESTIMATE_TITLE } from "@/lib/forecast-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const query = parseForecastQuery(body);
  if ("error" in query) return Response.json({ error: query.error, estimate: true }, { status: 400 });
  try {
    const result = await loadForecastExposure(query);
    return Response.json({
      estimate: true,
      title: ESTIMATE_TITLE,
      badge: ESTIMATE_BADGE,
      guide: ESTIMATE_GUIDE,
      ...result,
    });
  } catch (error) {
    console.error("[hailmap] forecast", error instanceof Error ? error.message : error);
    return Response.json(
      {
        error: "Could not build that estimate.",
        estimate: true,
        title: ESTIMATE_TITLE,
        badge: ESTIMATE_BADGE,
        guide: ESTIMATE_GUIDE,
      },
      { status: 500 },
    );
  }
}
