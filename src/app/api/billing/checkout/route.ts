import { readSession } from "@/lib/auth";
import { billingEnabled, priceIdFor, tierById } from "@/lib/billing";
import { publicOrigin } from "@/lib/public-origin";
import { getStripe } from "@/lib/stripe-server";
import { getAccountById, updateBilling } from "@/lib/user-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "Billing is not turned on for this server." }, { status: 503 });
  const sessionUser = readSession(request);
  if (!sessionUser || sessionUser.role !== "member") {
    return Response.json({ error: "Create an account before subscribing." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const tierId = body && typeof body === "object" ? String((body as { tier?: unknown }).tier ?? "") : "";
  const tier = tierById(tierId);
  const priceId = tier ? priceIdFor(tier.id) : null;
  if (!tier || !priceId) return Response.json({ error: "Choose Solo, Crew, or Storm Team." }, { status: 400 });
  const account = getAccountById(sessionUser.id);
  if (!account) return Response.json({ error: "Create an account before subscribing." }, { status: 401 });
  try {
    const stripe = getStripe();
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: account.email,
        name: account.name,
        metadata: { userId: account.id },
      });
      customerId = customer.id;
      updateBilling(account.id, { stripeCustomerId: customerId });
    }
    const origin = publicOrigin(request);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: account.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/account?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { userId: account.id, tier: tier.id, priceId },
      subscription_data: { metadata: { userId: account.id, tier: tier.id, priceId } },
    });
    if (!checkout.url) return Response.json({ error: "Stripe did not return a checkout link." }, { status: 502 });
    return Response.json({ url: checkout.url });
  } catch (error) {
    console.error("[hailmap] checkout", error instanceof Error ? error.message : "failed");
    return Response.json({ error: "Could not start checkout." }, { status: 502 });
  }
}
