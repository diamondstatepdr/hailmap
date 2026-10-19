import { readJson, requireDevice } from "@/lib/alert-http";
import { addArea, listAreas, updateDeviceSettings, type AreaInput } from "@/lib/alert-store";
import { validLatLon } from "@/lib/geo";
import type { WatchKind } from "@/lib/alert-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function areaInput(body: Record<string, unknown>): AreaInput {
  return {
    kind: body.kind as WatchKind,
    label: typeof body.label === "string" ? body.label : undefined,
    lat: body.lat == null ? null : Number(body.lat),
    lon: body.lon == null ? null : Number(body.lon),
    radiusMi: body.radiusMi == null ? undefined : Number(body.radiusMi),
    state: typeof body.state === "string" ? body.state : null,
    minSizeIn: body.minSizeIn == null ? undefined : Number(body.minSizeIn),
    mesh: typeof body.mesh === "boolean" ? body.mesh : undefined,
    reports: typeof body.reports === "boolean" ? body.reports : undefined,
    warnings: typeof body.warnings === "boolean" ? body.warnings : undefined,
    outlook: typeof body.outlook === "boolean" ? body.outlook : undefined,
  };
}

export function GET(request: Request) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  return Response.json({ areas: listAreas(auth.device.id) });
}

export async function POST(request: Request) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  const parsed = await readJson(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const input = areaInput(body);
  if ((input.kind === "point" || input.kind === "near") && input.lat != null && input.lon != null && !validLatLon(input.lat, input.lon)) {
    return Response.json({ error: "lat and lon are required" }, { status: 400 });
  }
  const created = addArea(auth.device.id, input);
  if ("error" in created) return Response.json({ error: created.error }, { status: 400 });
  if (input.kind === "near" && input.lat != null && input.lon != null) {
    updateDeviceSettings(auth.device.id, { lat: input.lat, lon: input.lon });
  }
  return Response.json({ area: created.area }, { status: 201 });
}
