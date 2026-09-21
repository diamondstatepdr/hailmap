import { getSwathCollection } from "@/lib/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const collection = await getSwathCollection();
    return Response.json(collection, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[hailmap] swaths", error instanceof Error ? error.message : error);
    return Response.json({ error: "Failed to build hail swaths" }, { status: 500 });
  }
}
