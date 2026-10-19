import { readJson, requireDevice } from "@/lib/alert-http";
import type { WatchKind } from "@/lib/alert-model";
import { deleteArea, updateArea, type AreaInput } from "@/lib/alert-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  const parsed = await readJson(request);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;
  const { id } = await context.params;
  const input: AreaInput = {
    kind: "point" as WatchKind,
    label: typeof body.label === "string" ? body.label : undefined,
    radiusMi: body.radiusMi == null ? undefined : Number(body.radiusMi),
    minSizeIn: body.minSizeIn == null ? undefined : Number(body.minSizeIn),
    mesh: typeof body.mesh === "boolean" ? body.mesh : undefined,
    reports: typeof body.reports === "boolean" ? body.reports : undefined,
    warnings: typeof body.warnings === "boolean" ? body.warnings : undefined,
    outlook: typeof body.outlook === "boolean" ? body.outlook : undefined,
  };
  const updated = updateArea(auth.device.id, id, input);
  if ("error" in updated) return Response.json({ error: updated.error }, { status: updated.error === "Watch area not found" ? 404 : 400 });
  return Response.json({ area: updated.area });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!deleteArea(auth.device.id, id)) return Response.json({ error: "Watch area not found" }, { status: 404 });
  return Response.json({ ok: true });
}
