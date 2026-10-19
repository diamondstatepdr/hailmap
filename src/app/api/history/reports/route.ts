import { parseHistoryBounds, queryHistoryMap } from "@/lib/history-query";
import { parseSpan } from "@/lib/history-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const span = parseSpan(url.searchParams.get("start"), url.searchParams.get("end"));
  if ("error" in span) return Response.json({ error: span.error }, { status: 400 });
  const bounds = parseHistoryBounds(url.searchParams);
  if ("error" in bounds) return Response.json({ error: bounds.error }, { status: 400 });
  try {
    const result = await queryHistoryMap({ span, bounds, state: url.searchParams.get("state") ?? "" });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[hailmap] history reports", error instanceof Error ? error.message : error);
    return Response.json({ error: "Storm history is unavailable right now." }, { status: 500 });
  }
}
