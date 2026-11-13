"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { SIGNUP_LEDE } from "@/lib/pitch";

const inputClass = "mt-1 w-full rounded-xl border border-line bg-app px-3 py-3 text-base";

export default function SignupForm() {
  const params = useSearchParams();
  const [name, setName] = useState("");
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
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const payload = (await response.json()) as { error?: string; billingEnabled?: boolean };
      if (!response.ok) {
        setError(payload.error ?? "Could not create the account");
        return;
      }
      window.location.assign(payload.billingEnabled ? "/pricing" : next);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-line bg-panel p-5 shadow-float">
      <h2 className="pitch-title text-2xl font-semibold tracking-tight">Create account</h2>
      <p className="pitch-copy mt-2 text-sm leading-relaxed text-muted">{SIGNUP_LEDE}</p>
      <p className="mt-2 text-sm">
        <Link href="/pricing" className="inline-flex min-h-11 items-center font-semibold text-accent">
          See plans
        </Link>
      </p>
      <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-3">
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
            enterKeyHint="next"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
          At least 10 characters. Use a password you have not used on another site.
        </p>
        {error ? <p className="text-sm text-muted">{error}</p> : null}
        <button type="submit" className="btn btn-primary press w-full" disabled={busy}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already have an account?{" "}
        <Link href={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} className="font-semibold text-accent">
          Sign in
        </Link>
      </p>
    </section>
  );
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}
