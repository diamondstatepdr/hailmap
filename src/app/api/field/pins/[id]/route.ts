import { asPinStatus, deletePin, updatePin } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clip(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const status = record.status == null ? undefined : asPinStatus(record.status);
  if (record.status != null && !status) {
    return Response.json({ error: "status must be damage, talked, away, or lead" }, { status: 400 });
  }
  const pin = updatePin(auth.user.id, id, {
    status: status ?? undefined,
    note: record.note === undefined ? undefined : clip(record.note, 500),
  });
  if (!pin) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ pin });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!deletePin(auth.user.id, id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
