import { readSession } from "@/lib/auth";
import { billingEnabled } from "@/lib/billing";
import { publicOrigin } from "@/lib/public-origin";
import { getStripe } from "@/lib/stripe-server";
import { getAccountById } from "@/lib/user-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "Billing is not turned on for this server." }, { status: 503 });
  const sessionUser = readSession(request);
  if (!sessionUser || sessionUser.role !== "member") {
    return Response.json({ error: "Sign in with your email account." }, { status: 401 });
  }
  const account = getAccountById(sessionUser.id);
  if (!account?.stripeCustomerId) {
    return Response.json({ error: "Subscribe before opening the billing portal." }, { status: 400 });
  }
  try {
    const portal = await getStripe().billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${publicOrigin(request)}/account`,
    });
    return Response.json({ url: portal.url });
  } catch (error) {
    console.error("[hailmap] portal", error instanceof Error ? error.message : "failed");
    return Response.json({ error: "Could not open the billing portal." }, { status: 502 });
  }
}
