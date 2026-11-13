"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface TierCard {
  id: string;
  name: string;
  blurb: string;
  audience: "individual" | "team";
  featured: boolean;
  amountLabel: string | null;
}

interface SessionPayload {
  user: { role?: string; name?: string } | null;
  billing?: { enabled?: boolean; access?: boolean; tierName?: string | null };
}

export default function PricingBoard() {
  const [enabled, setEnabled] = useState(false);
  const [tiers, setTiers] = useState<TierCard[]>([]);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void fetch("/api/billing/plans")
      .then((response) => response.json())
      .then((payload: { enabled?: boolean; tiers?: TierCard[] }) => {
        if (cancel) return;
        setEnabled(Boolean(payload.enabled));
        setTiers(payload.tiers ?? []);
      })
      .catch(() => {
        if (!cancel) setError("Could not load plans.");
      });
    void fetch("/api/auth/session")
      .then((response) => response.json())
      .then((payload: SessionPayload) => {
        if (!cancel) setSession(payload);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  const owner = session?.user?.role === "owner";
  const subscribed = Boolean(session?.user?.role === "member" && session.billing?.access && enabled);

  async function checkout(tierId: string) {
    setError(null);
    if (!session?.user) {
      window.location.assign(`/signup?next=${encodeURIComponent("/pricing")}`);
      return;
    }
    setBusy(tierId);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: tierId }),
      });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (response.status === 401) {
        window.location.assign(`/login?next=${encodeURIComponent("/pricing")}`);
        return;
      }
      if (!response.ok || !payload.url) {
        setError(payload.error ?? "Could not start checkout.");
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function portal() {
    setPortalBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        setError(payload.error ?? "Could not open billing.");
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPortalBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Plans</p>
      <h2 className="mt-1 text-3xl font-semibold tracking-tight">Solo is the way in</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        The live hail map stays free. Sales tools — door-knock routes, dealerships, canvass, hail proof PDFs, storm-to-cash, lead export, Money Hole, and field mode — need a plan. Solo is for one person. Crew and Storm Team are the higher prices for a crew.
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
      {subscribed ? (
        <p className="mt-4 text-sm text-muted">
          Current plan: {session?.billing?.tierName ?? "Active"}.{" "}
          <button type="button" className="font-semibold text-accent" onClick={() => void portal()} disabled={portalBusy}>
            {portalBusy ? "Opening…" : "Manage billing"}
          </button>
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 md:grid-cols-3 md:items-stretch">
        {tiers.map((tier) => (
          <article
            key={tier.id}
            data-plan={tier.id}
            data-featured={tier.featured ? "true" : "false"}
            className={
              tier.featured
                ? "flex flex-col rounded-3xl border-2 border-accent bg-panel p-5 shadow-float"
                : "flex flex-col rounded-3xl border border-line bg-panel p-5"
            }
          >
            {tier.featured ? (
              <p className="mb-3 inline-flex w-fit rounded-full bg-accent px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-accentink">
                Start here · one person
              </p>
            ) : (
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">For a crew</p>
            )}
            <h3 className="text-xl font-semibold tracking-tight">{tier.name}</h3>
            <p className={`mt-2 font-semibold tracking-tight ${tier.featured ? "text-3xl" : "text-2xl"}`}>
              {tier.amountLabel ?? "Monthly"}
            </p>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{tier.blurb}</p>
            {enabled && !owner ? (
              <button
                type="button"
                className={`btn press mt-5 w-full ${tier.featured ? "btn-primary" : "btn-secondary"}`}
                disabled={busy !== null}
                onClick={() => void checkout(tier.id)}
              >
                {busy === tier.id ? "Opening checkout…" : tier.featured ? "Continue with Solo" : `Choose ${tier.name}`}
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-muted">{error}</p> : null}
      <p className="mt-6 text-sm text-muted">
        Checkout and card details stay on Stripe. Cancel or change a plan in the billing portal.{" "}
        <Link href="/account" className="font-semibold text-accent">
          Your account
        </Link>
      </p>
    </div>
  );
}
