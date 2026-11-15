import { readSession } from "@/lib/auth";
import { revokeInvite } from "@/lib/team-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = readSession(request);
  if (!user || user.role !== "member") {
    return Response.json({ error: "Sign in with the account that pays for the plan." }, { status: 401 });
  }
  const { id } = await context.params;
  const revoked = revokeInvite(user.id, id);
  if (!revoked) return Response.json({ error: "That invite is no longer open." }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
