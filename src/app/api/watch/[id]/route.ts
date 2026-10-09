import { deleteWatch } from "@/lib/accounts";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!deleteWatch(auth.user.id, id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}
