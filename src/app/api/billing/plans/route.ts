import { billingEnabled, formatPlanAmount, priceIdFor, TIERS, type TierId } from "@/lib/billing";
import { getStripe } from "@/lib/stripe-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = billingEnabled();
  const tiers = await Promise.all(
    TIERS.map(async (tier) => {
      let amount: number | null = null;
      let currency: string | null = null;
      let interval: string | null = null;
      const priceId = enabled ? priceIdFor(tier.id as TierId) : null;
      if (enabled && priceId) {
        try {
          const price = await getStripe().prices.retrieve(priceId);
          amount = price.unit_amount;
          currency = price.currency;
          interval = price.recurring?.interval ?? null;
        } catch {
          amount = null;
        }
      }
      return {
        id: tier.id,
        name: tier.name,
        blurb: tier.blurb,
        audience: tier.audience,
        featured: tier.featured,
        amountLabel: formatPlanAmount(amount, currency, interval),
      };
    }),
  );
  return Response.json({ enabled, tiers }, { headers: { "Cache-Control": "no-store" } });
}
