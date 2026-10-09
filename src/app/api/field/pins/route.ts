import { asPinStatus, createPin, listPins } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";
import { validLatLon } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clip(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  return Response.json({ pins: listPins(auth.user.id) });
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
  const status = asPinStatus(record.status);
  if (!validLatLon(lat, lon)) return Response.json({ error: "lat and lon are required" }, { status: 400 });
  if (!status) return Response.json({ error: "status must be damage, talked, away, or lead" }, { status: 400 });
  const pin = createPin({ userId: auth.user.id, lat, lon, status, note: clip(record.note, 500) });
  if (!pin) return Response.json({ error: "Could not save that pin" }, { status: 400 });
  return Response.json({ pin }, { status: 201 });
}
