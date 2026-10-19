import { readJson, requireDevice } from "@/lib/alert-http";
import { parseClock } from "@/lib/alert-model";
import { updateDeviceSettings } from "@/lib/alert-store";
import { validLatLon } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  const parsed = await readJson(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const quietStart = "quietStart" in body ? (body.quietStart == null || body.quietStart === "" ? null : String(body.quietStart)) : undefined;
  const quietEnd = "quietEnd" in body ? (body.quietEnd == null || body.quietEnd === "" ? null : String(body.quietEnd)) : undefined;
  if (quietStart && parseClock(quietStart) == null) return Response.json({ error: "quietStart must be HH:MM" }, { status: 400 });
  if (quietEnd && parseClock(quietEnd) == null) return Response.json({ error: "quietEnd must be HH:MM" }, { status: 400 });
  let lat: number | null | undefined;
  let lon: number | null | undefined;
  if ("lat" in body || "lon" in body) {
    lat = body.lat == null ? null : Number(body.lat);
    lon = body.lon == null ? null : Number(body.lon);
    if (lat == null || lon == null || !validLatLon(lat, lon)) {
      return Response.json({ error: "lat and lon are required" }, { status: 400 });
    }
  }
  const device = updateDeviceSettings(auth.device.id, {
    quietStart,
    quietEnd,
    timeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
    lat,
    lon,
  });
  if (!device) return Response.json({ error: "This phone is not subscribed" }, { status: 401 });
  return Response.json({
    settings: {
      timeZone: device.timeZone,
      quietStart: device.quietStart,
      quietEnd: device.quietEnd,
      lat: device.lat,
      lon: device.lon,
      locationAt: device.locationAt,
    },
  });
}
