"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";

const inputClass = "mt-1 w-full rounded-xl border border-line bg-app px-3 py-3 text-base";

export default function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await response.json()) as { error?: string; billing?: { enabled?: boolean; access?: boolean } };
      if (!response.ok) {
        setError(payload.error ?? "Could not sign in");
        return;
      }
      const destination = payload.billing?.enabled && payload.billing.access === false ? "/pricing" : next;
      window.location.assign(destination);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-line bg-panel p-5 shadow-float">
      <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
      <p className="mt-1 text-sm text-muted">Email and password for your Swathline account.</p>
      <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-3">
        <label className="block text-sm font-medium" htmlFor="email">
          Email
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            spellCheck={false}
            enterKeyHint="next"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium" htmlFor="current-password">
          Password
          <input
            id="current-password"
            name="password"
            type="password"
            autoComplete="current-password"
            enterKeyHint="done"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </label>
        {error ? <p className="text-sm text-muted">{error}</p> : null}
        <button type="submit" className="btn btn-primary press w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        <Link href="/forgot" className="font-semibold text-accent">
          Forgot password?
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted">
        New here?{" "}
        <Link href={next === "/" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-accent">
          Create an account
        </Link>
      </p>
      <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
        <Link href="/?signin=team" className="font-semibold text-ink">
          Use the team passcode
        </Link>
        <span className="mt-1 block text-xs">The shared passcode still signs in the owner tools.</span>
      </p>
    </section>
  );
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}
