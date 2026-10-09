import { addWatch, listWatch } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { validLatLon } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  return Response.json({ places: listWatch(auth.user.id) });
}

export async function POST(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const lat = Number(record.lat);
  const lon = Number(record.lon);
  const radiusKm = Number(record.radiusKm ?? 15);
  if (!validLatLon(lat, lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
  if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 80) {
    return Response.json({ error: "radiusKm must be between 1 and 80" }, { status: 400 });
  }
  const place = addWatch({
    userId: auth.user.id,
    label: String(record.label ?? record.query ?? ""),
    query: String(record.query ?? record.label ?? ""),
    lat,
    lon,
    radiusKm,
  });
  if (!place) return Response.json({ error: "A label is required" }, { status: 400 });
  return Response.json({ place }, { status: 201 });
}
