import { replayManifest } from "@/lib/replay-day";
import { parseReplayQuery } from "@/lib/replay-time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const parsed = parseReplayQuery(new URL(request.url).searchParams);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const manifest = await replayManifest(parsed);
    const closed = Date.now() > Date.parse(`${manifest.date}T23:59:59Z`) + 18 * 3600 * 1000;
    return Response.json(manifest, {
      headers: { "Cache-Control": closed ? "public, max-age=300" : "no-store" },
    });
  } catch (error) {
    console.error("[hailmap] replay", error instanceof Error ? error.message : error);
    const message = error instanceof Error && /has not happened/.test(error.message) ? error.message : "That storm could not be replayed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
