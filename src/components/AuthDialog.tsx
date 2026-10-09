"use client";

import { useState, type FormEvent } from "react";

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
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-md rounded-3xl bg-panel p-5 shadow-sheet">
        <h2 className="text-lg font-semibold">Sign in</h2>
        <p className="mt-1 text-sm text-muted">
          Field notes, photos, and the watch list stay on your name. The public map does not require a sign-in.
          The name is the account, so use a distinct name for each person.
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
            className="mt-1 w-full rounded-xl border border-line bg-app px-3 py-2"
          />
        </label>
        <label className="mt-3 block text-sm font-medium">
          Team passcode
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-xl border border-line bg-app px-3 py-2"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-muted">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-2xl border border-line px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!configured || busy}
            className="flex-1 rounded-2xl bg-accent px-3 py-2 text-sm font-semibold text-accentink disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>
    </div>
  );
}
