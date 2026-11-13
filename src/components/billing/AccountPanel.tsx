"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface SessionPayload {
  user: { id: string; name: string; role?: string; email?: string } | null;
  billing?: { enabled?: boolean; access?: boolean; status?: string | null; tierName?: string | null };
}

export default function AccountPanel() {
  const params = useSearchParams();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    const sessionId = params.get("session_id");
    const finish = params.get("checkout") === "success" && sessionId;
    void (async () => {
      if (finish) {
        await fetch("/api/billing/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        }).catch(() => undefined);
      }
      const response = await fetch("/api/auth/session");
      const payload = (await response.json()) as SessionPayload;
      if (cancel) return;
      setSession(payload);
      if (finish && payload.billing?.access) setNote("You’re subscribed. Sales tools are open.");
      else if (finish) setNote("Payment received. Access updates as soon as Stripe confirms it.");
      if (params.get("checkout") === "cancel") setNote("Checkout was canceled. No charge was made.");
    })();
    return () => {
      cancel = true;
    };
  }, [params]);

  async function portal() {
    setBusy(true);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) {
        setNote(payload.error ?? "Could not open billing.");
        return;
      }
      window.location.assign(payload.url);
    } catch {
      setNote("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    window.location.assign("/");
  }

  const user = session?.user;
  const billing = session?.billing;
  const statusLabel = statusText(billing?.status);

  return (
    <section className="rounded-3xl border border-line bg-panel p-5 shadow-float">
      <h2 className="text-2xl font-semibold tracking-tight">Account</h2>
      {!session ? <p className="mt-3 text-sm text-muted">Loading…</p> : null}
      {session && !user ? (
        <div className="mt-4 space-y-3 text-sm text-muted">
          <p>Sign in to see your plan.</p>
          <Link href="/login" className="btn btn-primary press w-full">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-secondary press w-full">
            Create account
          </Link>
        </div>
      ) : null}
      {user ? (
        <div className="mt-4 space-y-3">
          <p className="text-lg font-semibold">{user.name}</p>
          {user.email ? <p className="text-sm text-muted">{user.email}</p> : null}
          {user.role === "owner" ? (
            <p className="rounded-2xl bg-app px-3 py-2 text-sm text-muted">
              Signed in with the team passcode. Sales tools are included for this login.
            </p>
          ) : null}
          {user.role === "member" ? (
            <p className="rounded-2xl bg-app px-3 py-2 text-sm">
              <span className="font-semibold">{billing?.tierName ?? "No plan"}</span>
              <span className="text-muted"> · {statusLabel}</span>
            </p>
          ) : null}
          {note ? <p className="text-sm text-muted">{note}</p> : null}
          <div className="flex flex-col gap-2">
            {billing?.enabled && user.role === "member" ? (
              billing.access ? (
                <button type="button" className="btn btn-primary press w-full" onClick={() => void portal()} disabled={busy}>
                  {busy ? "Opening…" : "Manage billing"}
                </button>
              ) : (
                <Link href="/pricing" className="btn btn-primary press w-full">
                  See Solo
                </Link>
              )
            ) : null}
            <Link href="/" className="btn btn-secondary press w-full">
              Back to the map
            </Link>
            <button type="button" className="btn btn-ghost press w-full" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function statusText(status: string | null | undefined): string {
  if (status === "active" || status === "trialing") return "Active";
  if (status === "past_due") return "Payment failed";
  if (status === "canceled") return "Canceled";
  if (!status) return "Not subscribed";
  return "Not active";
}
