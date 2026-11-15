import { billingEnabled } from "@/lib/billing";
import { applyBillingNotice, noticeFromStripeEvent } from "@/lib/billing-sync";
import { publicOrigin } from "@/lib/public-origin";
import { getStripe } from "@/lib/stripe-server";
import { deliverTrialReminder } from "@/lib/trial-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!billingEnabled()) return Response.json({ error: "Billing is not turned on." }, { status: 404 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });
  const raw = await request.text();
  let event: { type: string; data?: { object?: Record<string, unknown> } };
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "") as unknown as {
      type: string;
      data?: { object?: Record<string, unknown> };
    };
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  const notice = noticeFromStripeEvent(event);
  if (notice) applyBillingNotice(notice);
  const reminder = await deliverTrialReminder(event, publicOrigin(request));
  if (reminder === "failed") return Response.json({ error: "Could not send the trial reminder." }, { status: 500 });
  return Response.json({ received: true });
}
