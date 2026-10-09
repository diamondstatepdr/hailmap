import { readGeocodeCache, writeGeocodeCache } from "@/lib/accounts";
import { forwardGeocode, reverseStreet, type GeocodeCache } from "@/lib/forward-geocode";
import { validLatLon } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cache: GeocodeCache = {
  get(query) {
    const row = readGeocodeCache(query);
    return row ? row.places : null;
  },
  set(query, places, ttlMs) {
    writeGeocodeCache(query, places, ttlMs);
  },
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (url.searchParams.has("lat") || url.searchParams.has("lon")) {
    if (!validLatLon(lat, lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
    const street = await reverseStreet(lat, lon, cache);
    return Response.json(
      {
        lat,
        lon,
        street,
        streetStatus: street ? "ok" : "unavailable",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length < 3) return Response.json({ error: "Enter at least 3 characters" }, { status: 400 });
  if (q.length > 120) return Response.json({ error: "That search is too long" }, { status: 400 });
  const places = await forwardGeocode(q, cache);
  return Response.json({ query: q, places }, { headers: { "Cache-Control": "no-store" } });
}
