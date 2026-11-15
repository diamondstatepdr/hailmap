"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface InviteInfo {
  email: string;
  ownerName: string;
  planName: string;
  status: "open" | "accepted" | "revoked";
}

interface SessionUser {
  email?: string;
  role?: string;
  name?: string;
}

const inputClass = "mt-1 w-full rounded-xl border border-line bg-app px-3 py-3 text-base";

export default function InviteAccept({ token }: { token: string }) {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [mode, setMode] = useState<"new" | "in">("new");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const [inviteResponse, sessionResponse] = await Promise.all([
        fetch(`/api/team/join/${token}`),
        fetch("/api/auth/session"),
      ]);
      if (cancel) return;
      if (!inviteResponse.ok) {
        setMissing(true);
        return;
      }
      setInvite((await inviteResponse.json()) as InviteInfo);
      const session = (await sessionResponse.json()) as { user: SessionUser | null };
      setUser(session.user);
    })();
    return () => {
      cancel = true;
    };
  }, [token]);

  async function join(cookieReady = true) {
    if (!cookieReady) return;
    const response = await fetch(`/api/team/join/${token}`, { method: "POST" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Could not join this team.");
      return;
    }
    window.location.assign("/");
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email: invite.email, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not create the account.");
        return;
      }
      await join();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: invite.email, password }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not sign in.");
        return;
      }
      await join();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <section className="rounded-3xl border border-line bg-panel p-5 shadow-float">
        <h2 className="text-2xl font-semibold tracking-tight">Invite link not valid</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Ask the person who pays for the plan to send a new link.</p>
      </section>
    );
  }

  if (!invite) {
    return (
      <section className="rounded-3xl border border-line bg-panel p-5 shadow-float">
        <p className="text-sm text-muted">Loading…</p>
      </section>
    );
  }

  if (invite.status === "revoked") {
    return (
      <section className="rounded-3xl border border-line bg-panel p-5 shadow-float" data-invite>
        <h2 className="text-2xl font-semibold tracking-tight">Invite canceled</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Ask {invite.ownerName} for a new link.</p>
      </section>
    );
  }

  if (invite.status === "accepted") {
    return (
      <section className="rounded-3xl border border-line bg-panel p-5 shadow-float" data-invite>
        <h2 className="text-2xl font-semibold tracking-tight">This invite was already used</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">Sign in if you already joined {invite.ownerName}&apos;s team.</p>
        <Link href="/login" className="btn btn-primary press mt-4 w-full">
          Sign in
        </Link>
      </section>
    );
  }

  const signedInAsInvitee = user?.role === "member" && user.email?.toLowerCase() === invite.email;

  return (
    <section className="rounded-3xl border border-line bg-panel p-5 shadow-float" data-invite>
      <h2 className="pitch-title text-2xl font-semibold tracking-tight">Join {invite.ownerName}&apos;s team</h2>
      <p className="pitch-copy mt-2 text-sm leading-relaxed text-muted">
        {invite.ownerName} invited {invite.email} to their {invite.planName} plan. You get the sales tools through their
        subscription. You don&apos;t pay separately.
      </p>
      {signedInAsInvitee ? (
        <button type="button" className="btn btn-primary press mt-4 w-full" disabled={busy} onClick={() => void join()}>
          {busy ? "Joining…" : "Join team"}
        </button>
      ) : (
        <>
          {user?.email ? (
            <p className="mt-3 text-sm text-muted">
              You&apos;re signed in as {user.email}. This invite is for {invite.email}.{" "}
              <button
                type="button"
                className="font-semibold text-accent"
                onClick={() => {
                  void fetch("/api/auth/session", { method: "DELETE" }).then(() => setUser(null));
                }}
              >
                Sign out
              </button>
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={`btn press flex-1 ${mode === "new" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("new")}>
              Create account
            </button>
            <button type="button" className={`btn press flex-1 ${mode === "in" ? "btn-primary" : "btn-secondary"}`} onClick={() => setMode("in")}>
              I already have an account
            </button>
          </div>
          <div hidden={mode !== "new"}>
            <form className="mt-4 space-y-3" onSubmit={(event) => void createAccount(event)}>
              <label className="block text-sm font-medium" htmlFor="full-name">
                Name
                <input
                  id="full-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  enterKeyHint="next"
                  required
                  minLength={2}
                  maxLength={60}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium" htmlFor="email">
                Email
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  readOnly
                  value={invite.email}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium" htmlFor="new-password">
                Password
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  enterKeyHint="done"
                  required
                  minLength={10}
                  maxLength={200}
                  aria-describedby="password-hint"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                />
              </label>
              <p id="password-hint" className="text-xs text-muted">
                At least 10 characters.
              </p>
              <button type="submit" className="btn btn-primary press w-full" disabled={busy}>
                {busy ? "Creating…" : "Create account and join"}
              </button>
            </form>
          </div>
          <div hidden={mode !== "in"}>
            <form className="mt-4 space-y-3" onSubmit={(event) => void signIn(event)}>
              <label className="block text-sm font-medium" htmlFor="signin-email">
                Email
                <input
                  id="signin-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  spellCheck={false}
                  readOnly
                  value={invite.email}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm font-medium" htmlFor="current-password">
                Password
                <input
                  id="current-password"
                  name="current-password"
                  type="password"
                  autoComplete="current-password"
                  enterKeyHint="done"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={inputClass}
                />
              </label>
              <button type="submit" className="btn btn-primary press w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in and join"}
              </button>
            </form>
          </div>
        </>
      )}
      {error ? (
        <p className="mt-3 text-sm text-muted" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
