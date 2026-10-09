"use client";

import { useState, type FormEvent } from "react";
import { LogoMark } from "@/components/brand/Logo";

interface Props {
  configured: boolean;
  onClose: () => void;
  onSignedIn: (user: { id: string; name: string }) => void;
}

export default function AuthDialog({ configured, onClose, onSignedIn }: Props) {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, passcode }),
      });
      const payload = (await response.json()) as { user?: { id: string; name: string }; error?: string };
      if (!response.ok || !payload.user) {
        setError(payload.error ?? "Could not sign in");
        return;
      }
      onSignedIn(payload.user);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center">
      <form onSubmit={(event) => void submit(event)} className="page-enter w-full max-w-md rounded-3xl border border-line bg-panel p-5 shadow-float">
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Sign in</h2>
            <p className="text-xs text-muted">Team account</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Field notes, photos, and the watch list stay on your name. The public map does not require a sign-in. The name is the account, so use a distinct name for each person.
        </p>
        {configured ? null : (
          <p className="mt-3 rounded-2xl bg-app px-3 py-2 text-sm text-muted">
            Sign-in is not configured. Set HAILMAP_TEAM_PASSCODE on the server.
          </p>
        )}
        <label className="mt-4 block text-sm font-medium">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="username"
            className="mt-1 w-full rounded-xl border border-line bg-app px-3 py-2.5"
          />
        </label>
        <label className="mt-3 block text-sm font-medium">
          Team passcode
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-xl border border-line bg-app px-3 py-2.5"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-muted">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary press flex-1">
            Cancel
          </button>
          <button type="submit" disabled={!configured || busy} className="btn btn-primary press flex-1">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
