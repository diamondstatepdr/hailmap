import { requireDevice } from "@/lib/alert-http";
import { listAreas, listInbox } from "@/lib/alert-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  const device = auth.device;
  return Response.json({
    settings: {
      timeZone: device.timeZone,
      quietStart: device.quietStart,
      quietEnd: device.quietEnd,
      lat: device.lat,
      lon: device.lon,
      locationAt: device.locationAt,
    },
    areas: listAreas(device.id),
    inbox: listInbox(device.id),
  });
}
