import { readSession } from "@/lib/auth";
import { removeMember } from "@/lib/team-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = readSession(request);
  if (!user || user.role !== "member") {
    return Response.json({ error: "Sign in with the account that pays for the plan." }, { status: 401 });
  }
  const { id } = await context.params;
  if (!id || id === user.id) return Response.json({ error: "That person is not on your team." }, { status: 404 });
  const removed = removeMember(user.id, id);
  if (!removed) return Response.json({ error: "That person is not on your team." }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
