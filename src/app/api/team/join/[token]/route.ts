import { readSession } from "@/lib/auth";
import { acceptInvite, previewInvite } from "@/lib/team-store";
import { getAccountById } from "@/lib/user-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const invite = previewInvite(token);
  if (!invite) return Response.json({ error: "This invite link is not valid." }, { status: 404 });
  return Response.json(invite, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const user = readSession(request);
  if (!user || user.role !== "member") {
    return Response.json({ error: "Sign in with the invited email." }, { status: 401 });
  }
  const account = getAccountById(user.id);
  if (!account) return Response.json({ error: "Sign in with the invited email." }, { status: 401 });
  const { token } = await context.params;
  const result = acceptInvite(token, { id: account.id, email: account.email });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
