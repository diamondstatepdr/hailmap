import { cachedChase, chaseCacheStale, writeChaseCache } from "@/lib/chase-cache";
import { computeChase } from "@/lib/chase-build";
import { scheduleChaseRefresh } from "@/lib/chase-warm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const cached = cachedChase(now);
  if (cached) {
    if (cached.partial || chaseCacheStale(cached, now)) scheduleChaseRefresh();
    const cache = cached.partial ? "no-store" : "public, max-age=120";
    return Response.json(cached, { headers: { "Cache-Control": cache } });
  }
  try {
    const payload = await computeChase(now);
    writeChaseCache(payload);
    if (payload.partial) scheduleChaseRefresh();
    const cache = payload.partial ? "no-store" : "public, max-age=300";
    return Response.json(payload, { headers: { "Cache-Control": cache } });
  } catch (error) {
    console.error("[hailmap] chase", error instanceof Error ? error.message : error);
    return Response.json({ error: "This week's Money Holes are unavailable right now." }, { status: 502 });
  }
}
