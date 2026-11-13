"use client";

import { useEffect, useState } from "react";
import PricingOffer, { type OfferTier } from "@/components/billing/PricingOffer";

interface SessionPayload {
  user: { role?: string; name?: string } | null;
  billing?: { enabled?: boolean; access?: boolean; tierName?: string | null; trialEligible?: boolean };
}

export default function PricingBoard() {
  const [enabled, setEnabled] = useState(false);
  const [tiers, setTiers] = useState<OfferTier[]>([]);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void fetch("/api/billing/plans")
      .then((response) => response.json())
      .then((payload: { enabled?: boolean; tiers?: OfferTier[] }) => {
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
  const trialEligible = enabled && session?.billing?.trialEligible !== false;

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
    <PricingOffer
      enabled={enabled}
      trialEligible={trialEligible}
      owner={owner}
      subscribedName={subscribed ? (session?.billing?.tierName ?? "Active") : null}
      busy={busy}
      portalBusy={portalBusy}
      tiers={tiers}
      error={error}
      onCheckout={(tierId) => void checkout(tierId)}
      onPortal={() => void portal()}
    />
  );
}
