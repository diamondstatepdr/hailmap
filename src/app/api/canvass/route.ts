import { asCanvassStatus } from "@/lib/canvass";
import { listCanvass, saveCanvass } from "@/lib/canvass-store";
import { requireUser } from "@/lib/auth";
import { validLatLon } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function boundsOf(url: URL): { west: number; south: number; east: number; north: number } | null {
  const west = Number(url.searchParams.get("west"));
  const south = Number(url.searchParams.get("south"));
  const east = Number(url.searchParams.get("east"));
  const north = Number(url.searchParams.get("north"));
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  if (north > 90 || south < -90 || west < -180 || east > 180) return null;
  return { west, south, east, north };
}

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const stops = listCanvass(boundsOf(new URL(request.url)));
  return Response.json({ stops });
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
  const status = asCanvassStatus(record.status);
  const address = String(record.address ?? "").trim();
  if (!validLatLon(lat, lon) || address.length < 2) {
    return Response.json({ error: "An address, latitude, and longitude are required." }, { status: 400 });
  }
  if (!status) {
    return Response.json({ error: "Status must be knocked, not home, interested, or signed." }, { status: 400 });
  }
  const hailIn = record.hailIn == null || record.hailIn === "" ? null : Number(record.hailIn);
  const stop = saveCanvass({
    user: auth.user,
    address,
    lat,
    lon,
    status,
    note: record.note == null ? null : String(record.note),
    hailIn: hailIn != null && Number.isFinite(hailIn) ? hailIn : null,
  });
  if (!stop) return Response.json({ error: "Could not save that house." }, { status: 400 });
  return Response.json({ stop });
}
