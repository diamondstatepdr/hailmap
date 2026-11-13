import Link from "next/link";
import { PITCH_FEATURES, PITCH_FREE, PITCH_LEDE, PITCH_PAID, PITCH_TITLE, TRIAL_BUTTON, TRIAL_LABEL } from "@/lib/pitch";

export interface OfferTier {
  id: string;
  name: string;
  blurb: string;
  audience: "individual" | "team";
  featured: boolean;
  amountLabel: string | null;
}

interface Props {
  enabled: boolean;
  trialEligible: boolean;
  owner: boolean;
  subscribedName: string | null;
  busy: string | null;
  portalBusy?: boolean;
  tiers: OfferTier[];
  error?: string | null;
  onCheckout: (tierId: string) => void;
  onPortal: () => void;
}

export default function PricingOffer({
  enabled,
  trialEligible,
  owner,
  subscribedName,
  busy,
  portalBusy = false,
  tiers,
  error = null,
  onCheckout,
  onPortal,
}: Props) {
  const showCheckout = enabled && !owner && !subscribedName;

  return (
    <div className="pitch">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">For PDR techs</p>
      <h2 className="pitch-title mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{PITCH_TITLE}</h2>
      <p className="pitch-copy mt-3 max-w-2xl text-base leading-relaxed text-muted">{PITCH_LEDE}</p>
      <p className="pitch-copy mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        {PITCH_FREE} {PITCH_PAID}
      </p>
      <ul className="feature-list" role="list">
        {PITCH_FEATURES.map((feature) => (
          <li key={feature.title} className="rounded-2xl border border-line bg-panel px-3 py-3">
            <p className="font-semibold">{feature.title}</p>
            <p className="pitch-copy mt-1 text-sm leading-relaxed text-muted">{feature.detail}</p>
          </li>
        ))}
      </ul>

      <p className="pitch-title mt-8 text-xl font-semibold tracking-tight">Solo, Crew, and Storm Team</p>
      <p className="pitch-copy mt-1 max-w-2xl text-sm leading-relaxed text-muted">
        Same tools on every plan. Solo is one person. Crew and Storm Team are the higher prices for a crew.
        {trialEligible ? ` Each plan starts with a ${TRIAL_LABEL}.` : ""}
      </p>
      {!enabled ? (
        <p className="mt-4 rounded-2xl border border-line bg-panel px-4 py-3 text-sm text-muted">
          Subscriptions are not turned on for this server. The map and the sales tools stay available.
        </p>
      ) : null}
      {owner && enabled ? (
        <p className="mt-4 rounded-2xl border border-line bg-panel px-4 py-3 text-sm text-muted">
          The team passcode already includes these tools.
        </p>
      ) : null}
      {subscribedName ? (
        <p className="mt-4 text-sm text-muted">
          Current plan: {subscribedName}.{" "}
          <button type="button" className="font-semibold text-accent" onClick={onPortal} disabled={portalBusy}>
            {portalBusy ? "Opening…" : "Manage billing"}
          </button>
        </p>
      ) : null}
      {enabled && !trialEligible && !owner && !subscribedName ? (
        <p className="mt-4 text-sm text-muted">This account already used its free trial.</p>
      ) : null}
      {tiers.length === 0 ? <p className="mt-4 text-sm text-muted">Loading plans…</p> : null}
      <div className="plan-grid">
        {tiers.map((tier) => (
          <article
            key={tier.id}
            data-plan={tier.id}
            data-featured={tier.featured ? "true" : "false"}
            className={
              tier.featured
                ? "flex min-w-0 flex-col rounded-3xl border-2 border-accent bg-panel p-5 shadow-float"
                : "flex min-w-0 flex-col rounded-3xl border border-line bg-panel p-5"
            }
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              {tier.featured ? "One person" : "For a crew"}
            </p>
            <h3 className="pitch-title mt-2 text-xl font-semibold tracking-tight">{tier.name}</h3>
            <p className={`mt-2 font-semibold tracking-tight ${tier.featured ? "text-3xl" : "text-2xl"}`}>
              {tier.amountLabel ?? "Monthly"}
            </p>
            {trialEligible ? <p className="mt-1 text-sm font-semibold text-accent">{TRIAL_LABEL}</p> : null}
            <p className="pitch-copy mt-2 flex-1 text-sm leading-relaxed text-muted">{tier.blurb}</p>
            {showCheckout ? (
              <button
                type="button"
                className={`btn press plan-cta mt-5 w-full ${tier.featured ? "btn-primary" : "btn-secondary"}`}
                aria-label={trialEligible ? `${TRIAL_BUTTON} on ${tier.name}` : `Subscribe to ${tier.name}`}
                disabled={busy !== null}
                onClick={() => onCheckout(tier.id)}
              >
                {busy === tier.id ? "Opening checkout…" : trialEligible ? TRIAL_BUTTON : `Subscribe to ${tier.name}`}
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {error ? (
        <p className="mt-4 text-sm text-muted" role="alert">
          {error}
        </p>
      ) : null}
      <p className="pitch-copy mt-6 text-sm leading-relaxed text-muted">
        {trialEligible
          ? "Card stays on Stripe. You are charged after 7 days unless you cancel. One trial for each account. "
          : "Card stays on Stripe. "}
        Cancel or change a plan in the billing portal.{" "}
        <Link href="/account" className="font-semibold text-accent">
          Your account
        </Link>
      </p>
    </div>
  );
}
