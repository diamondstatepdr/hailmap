import Stripe from "stripe";

let cached: { key: string; stripe: Stripe } | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key) throw new Error("Stripe is not configured");
  if (!cached || cached.key !== key) {
    cached = { key, stripe: new Stripe(key, { maxNetworkRetries: 0, timeout: 8000 }) };
  }
  return cached.stripe;
}
