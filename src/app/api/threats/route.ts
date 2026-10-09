import { emptyThreats, getLiveThreats } from "@/lib/live-threats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const body = await getLiveThreats();
    return Response.json(body, {
      headers: { "Cache-Control": "public, max-age=120" },
    });
  } catch (error) {
    console.error("[hailmap] threats", error instanceof Error ? error.message : error);
    return Response.json(emptyThreats());
  }
}
