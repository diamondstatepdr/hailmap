import { readSession } from "@/lib/auth";
import { tierForPrice } from "@/lib/billing";
import { sendMail } from "@/lib/mail";
import { inviteEmail } from "@/lib/mail-copy";
import { publicOrigin } from "@/lib/public-origin";
import { createInvite, teamOverview, type OpenInvite } from "@/lib/team-store";
import { getAccountById } from "@/lib/user-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireMember(request: Request): { user: { id: string; name: string; role?: "owner" | "member"; email?: string } } | { response: Response } {
  const user = readSession(request);
  if (!user) return { response: Response.json({ error: "Sign in with your email account." }, { status: 401 }) };
  return { user };
}

function withUrls(invites: OpenInvite[], request: Request) {
  const origin = publicOrigin(request);
  return invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    createdAt: invite.createdAt,
    url: `${origin}/invite/${invite.token}`,
  }));
}

export async function GET(request: Request) {
  const auth = requireMember(request);
  if ("response" in auth) return auth.response;
  const team = teamOverview(auth.user);
  return Response.json({ ...team, invites: withUrls(team.invites, request) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = requireMember(request);
  if ("response" in auth) return auth.response;
  if (auth.user.role !== "member") {
    return Response.json({ error: "Sign in with the email account that pays for the plan." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const email = body && typeof body === "object" ? String((body as { email?: unknown }).email ?? "") : "";
  const result = createInvite(auth.user.id, email);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  const [invite] = withUrls([result.invite], request);
  let emailed = false;
  if (invite && process.env.RESEND_API_KEY?.trim()) {
    const owner = getAccountById(auth.user.id);
    const sent = await sendMail(
      inviteEmail({
        to: invite.email,
        ownerName: owner?.name || auth.user.name,
        planName: tierForPrice(owner?.subscriptionPriceId)?.name ?? "plan",
        joinUrl: invite.url,
      }),
    );
    emailed = sent.sent;
  }
  return Response.json({ invite, emailed }, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store" } });
}
