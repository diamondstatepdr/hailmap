/**
 * Plan names and who they are for. Dollar amounts are never stored here.
 * Each plan's Stripe Price id comes from the environment. Billing stays off
 * until the secret key, webhook secret, and every price id are set.
 */
export const TIERS = [
  {
    id: "solo",
    name: "Solo",
    audience: "individual",
    featured: true,
    blurb: "For one tech. The live map plus the sales tools on a single login.",
    env: "STRIPE_PRICE_SOLO",
  },
  {
    id: "crew",
    name: "Crew",
    audience: "team",
    featured: false,
    blurb: "For a crew. The same sales tools, priced for more than one person.",
    env: "STRIPE_PRICE_CREW",
  },
  {
    id: "storm",
    name: "Storm Team",
    audience: "team",
    featured: false,
    blurb: "For a larger crew working the same storms.",
    env: "STRIPE_PRICE_STORM",
  },
] as const;

export type TierId = (typeof TIERS)[number]["id"];
export type Tier = (typeof TIERS)[number];

/** Card is collected at checkout. Stripe bills the plan after this many days. */
export const TRIAL_DAYS = 7;

/**
 * One trial per account. Any subscription on the row — including a canceled
 * one — has already used it. A Stripe customer with no subscription yet has not.
 */
export function canStartTrial(
  account: { subscriptionStatus?: string | null; stripeSubscriptionId?: string | null } | null,
): boolean {
  if (!account) return true;
  if (account.stripeSubscriptionId?.trim()) return false;
  if (account.subscriptionStatus?.trim()) return false;
  return true;
}

const STRIPE_ENV = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", ...TIERS.map((tier) => tier.env)] as const;

export function billingEnabled(): boolean {
  return STRIPE_ENV.every((name) => Boolean(process.env[name]?.trim()));
}

export function tierById(id: string): Tier | null {
  return TIERS.find((tier) => tier.id === id) ?? null;
}

export function priceIdFor(id: TierId): string | null {
  const tier = tierById(id);
  if (!tier) return null;
  const value = process.env[tier.env]?.trim();
  return value || null;
}

export function tierForPrice(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  return TIERS.find((tier) => process.env[tier.env]?.trim() === priceId) ?? null;
}

/** Active and trialing subscriptions can use sales tools. Past due does not. */
export function subscriptionGrantsAccess(status: string | null | undefined): boolean {
  const value = status?.trim().toLowerCase();
  return value === "active" || value === "trialing";
}

export function billingSnapshot(
  user: { role?: string } | null,
  account: {
    subscriptionStatus: string | null;
    subscriptionPriceId: string | null;
    stripeSubscriptionId?: string | null;
  } | null,
) {
  const enabled = billingEnabled();
  const status = account?.subscriptionStatus ?? null;
  const tier = tierForPrice(account?.subscriptionPriceId ?? null);
  const access = !enabled || Boolean(user && (user.role !== "member" || subscriptionGrantsAccess(status)));
  return {
    enabled,
    access,
    status: enabled ? status : null,
    tier: tier?.id ?? null,
    tierName: tier?.name ?? null,
    trialEligible: canStartTrial(account),
  };
}

export function formatPlanAmount(amount: number | null, currency: string | null, interval: string | null): string | null {
  if (amount == null || !currency) return null;
  try {
    const value = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
    if (interval === "month") return `${value}/mo`;
    if (interval === "year") return `${value}/yr`;
    if (interval === "week") return `${value}/wk`;
    return value;
  } catch {
    return null;
  }
}

export const SALES_TOOLS = [
  "Door-knock routes",
  "Dealership hit list",
  "Canvass tracker",
  "Hail proof PDF",
  "Storm-to-cash",
  "Lead export",
  "Money Hole",
  "Field mode",
] as const;
