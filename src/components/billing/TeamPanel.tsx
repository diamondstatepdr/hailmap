"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface MemberRow {
  id: string;
  name: string;
  email: string;
}

interface InviteRow {
  id: string;
  email: string;
  url: string;
}

interface TeamPayload {
  role: "owner" | "mate" | "passcode";
  ownerName: string | null;
  planName: string | null;
  active: boolean;
  cap: number;
  people: number;
  pending: number;
  overCap: boolean;
  canInvite: boolean;
  notice: string | null;
  members: MemberRow[];
  invites: InviteRow[];
}

const inputClass = "mt-1 w-full rounded-xl border border-line bg-app px-3 py-3 text-base";

export default function TeamPanel({ onRole }: { onRole?: (role: TeamPayload["role"]) => void }) {
  const [team, setTeam] = useState<TeamPayload | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/team");
    if (!response.ok) return;
    const payload = (await response.json()) as TeamPayload;
    setTeam(payload);
    onRole?.(payload.role);
  }

  useEffect(() => {
    let cancel = false;
    void fetch("/api/team")
      .then(async (response) => {
        if (cancel) return;
        if (!response.ok) {
          onRole?.("owner");
          return;
        }
        const payload = (await response.json()) as TeamPayload;
        if (cancel) return;
        setTeam(payload);
        onRole?.(payload.role);
      })
      .catch(() => {
        if (!cancel) onRole?.("owner");
      });
    return () => {
      cancel = true;
    };
  }, [onRole]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("Copied");
    } catch {
      setCopied("Select the link and copy it");
    }
  }

  async function createInvite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCopied(null);
    try {
      const response = await fetch("/api/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not create that invite.");
        return;
      }
      setEmail("");
      await load();
      setCopied("Invite link ready. Copy it and text it.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const response = await fetch(`/api/team/members/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not remove that person.");
      return;
    }
    await load();
  }

  async function cancelInvite(id: string) {
    setError(null);
    const response = await fetch(`/api/team/invites/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Could not cancel that invite.");
      return;
    }
    await load();
  }

  if (!team || team.role === "passcode") return null;

  return (
    <section className="border-t border-line pt-4" aria-labelledby="team-heading" data-team>
      <h3 id="team-heading" className="text-lg font-semibold tracking-tight">
        Team
      </h3>
      {team.role === "mate" ? (
        <p className="mt-2 text-sm leading-relaxed text-muted">{team.notice}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">
            {team.people} of {team.cap} {team.cap === 1 ? "person" : "people"}. You count as one.
            {team.pending > 0 ? ` ${team.pending} invite${team.pending === 1 ? "" : "s"} waiting.` : ""}
          </p>
          {team.notice ? (
            <p className="mt-2 text-sm leading-relaxed" role="status">
              {team.notice}{" "}
              {!team.active || team.cap <= 1 ? (
                <Link href="/pricing" className="font-semibold text-accent">
                  See plans
                </Link>
              ) : null}
            </p>
          ) : null}
          {team.canInvite ? (
            <form className="mt-3 space-y-3" aria-labelledby="team-heading" onSubmit={(event) => void createInvite(event)}>
              <label className="block text-sm font-medium" htmlFor="invite-email">
                Teammate email
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  enterKeyHint="done"
                  required
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "invite-error" : undefined}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (error) setError(null);
                  }}
                  className={inputClass}
                />
              </label>
              <button type="submit" className="btn btn-primary press w-full" disabled={busy}>
                {busy ? "Creating link…" : "Create invite link"}
              </button>
            </form>
          ) : null}
          {error ? (
            <p id="invite-error" className="mt-2 text-sm text-muted" role="alert">
              {error}
            </p>
          ) : null}
          {copied ? (
            <p className="mt-2 text-sm text-muted" role="status">
              {copied}
            </p>
          ) : null}
          {team.members.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {team.members.map((member) => (
                <li key={member.id} className="flex items-center justify-between gap-3 rounded-2xl bg-app px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{member.name}</span>
                    <span className="block truncate text-xs text-muted">{member.email}</span>
                  </span>
                  <button type="button" className="btn btn-ghost press shrink-0" onClick={() => void remove(member.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {team.invites.length > 0 ? (
            <ul className="mt-3 space-y-3">
              {team.invites.map((invite) => (
                <li key={invite.id} className="rounded-2xl bg-app px-3 py-3">
                  <p className="text-sm font-semibold">{invite.email}</p>
                  <p className="text-xs text-muted">Waiting. Text them this link. There is no invite email.</p>
                  <label className="mt-2 block text-xs font-medium" htmlFor={`invite-link-${invite.id}`}>
                    Invite link
                    <input
                      id={`invite-link-${invite.id}`}
                      readOnly
                      value={invite.url}
                      onFocus={(event) => event.currentTarget.select()}
                      className={inputClass}
                    />
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn btn-secondary press flex-1" onClick={() => void copyLink(invite.url)}>
                      Copy link
                    </button>
                    <button type="button" className="btn btn-ghost press flex-1" onClick={() => void cancelInvite(invite.id)}>
                      Cancel invite
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
