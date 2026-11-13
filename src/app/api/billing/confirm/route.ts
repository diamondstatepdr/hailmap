import { readSession } from "@/lib/auth";
import { billingEnabled, billingSnapshot } from "@/lib/billing";
import { applyBillingNotice, noticeFromStripeEvent } from "@/lib/billing-sync";
import { getStripe } from "@/lib/stripe-server";
import { getAccountById } from "@/lib/user-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Applies a Checkout session the signed-in user just finished, before the webhook arrives. */
export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "Billing is not turned on for this server." }, { status: 503 });
  const sessionUser = readSession(request);
  if (!sessionUser || sessionUser.role !== "member") {
    return Response.json({ error: "Sign in with your email account." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const sessionId = body && typeof body === "object" ? String((body as { sessionId?: unknown }).sessionId ?? "") : "";
  if (!sessionId.startsWith("cs_")) return Response.json({ error: "Missing checkout session." }, { status: 400 });
  try {
    const checkout = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    const owner = checkout.client_reference_id || checkout.metadata?.userId;
    if (owner !== sessionUser.id) return Response.json({ error: "That checkout belongs to another account." }, { status: 403 });
    const notice = noticeFromStripeEvent({
      type: "checkout.session.completed",
      data: { object: checkout as unknown as Record<string, unknown> },
    });
    if (notice) applyBillingNotice(notice);
    const account = getAccountById(sessionUser.id);
    return Response.json({ billing: billingSnapshot(sessionUser, account) });
  } catch (error) {
    console.error("[hailmap] confirm", error instanceof Error ? error.message : "failed");
    return Response.json({ error: "Could not confirm that checkout." }, { status: 502 });
  }
}
