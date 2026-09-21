import { getMapReports } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getMapReports();
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[hailmap] reports", error instanceof Error ? error.message : error);
    return Response.json({ error: "Failed to load hail reports" }, { status: 500 });
  }
}
