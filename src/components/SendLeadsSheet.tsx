"use client";

import { useEffect, useState } from "react";
import BottomSheet from "@/components/ui/BottomSheet";
import type { CrmProvider } from "@/lib/crm";

interface PublicSettings {
  provider: CrmProvider | null;
  configured: boolean;
  recordType: string;
  statusName: string;
}

const CHOICES: Array<{ id: CrmProvider; label: string; hint: string }> = [
  { id: "webhook", label: "Zapier or webhook", hint: "Paste the https link Zapier gives you." },
  { id: "jobnimbus", label: "JobNimbus", hint: "Paste the API key from JobNimbus settings." },
  { id: "acculynx", label: "AccuLynx", hint: "Paste the API key from AccuLynx. A lead needs a street address." },
];

export default function SendLeadsSheet({
  onClose,
  signedIn,
  onSignIn,
}: {
  onClose: () => void;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const [provider, setProvider] = useState<CrmProvider>("webhook");
  const [configured, setConfigured] = useState(false);
  const [secret, setSecret] = useState("");
  const [recordType, setRecordType] = useState("Customer");
  const [statusName, setStatusName] = useState("Lead");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "send" | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancel = false;
    void fetch("/api/crm/settings")
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as PublicSettings;
        if (cancel) return;
        if (body.provider) setProvider(body.provider);
        setConfigured(Boolean(body.configured));
        if (body.recordType) setRecordType(body.recordType);
        if (body.statusName) setStatusName(body.statusName);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [signedIn]);

  async function save() {
    setBusy("save");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/crm/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, secret, recordType, statusName }),
      });
      const body = (await response.json()) as PublicSettings & { error?: string };
      if (!response.ok) {
        setError(body.error || "Could not save that.");
        return;
      }
      setSecret("");
      setConfigured(true);
      setMessage("Saved. The key stays on this server and is not shown again.");
    } catch {
      setError("Could not save that.");
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/crm/test", { method: "POST" });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) setError(body.error || "The test failed.");
      else setMessage(body.message || "Connected.");
    } catch {
      setError("Could not reach that service.");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/api/crm/leads", { method: "POST" });
      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) setError(body.error || "Could not send leads.");
      else setMessage(body.message || "Sent.");
    } catch {
      setError("Could not send leads.");
    } finally {
      setBusy(null);
    }
  }

  const choice = CHOICES.find((item) => item.id === provider) ?? CHOICES[0];

  return (
    <div className="sheet-dock pointer-events-none absolute inset-x-0 bottom-0 z-40">
      <BottomSheet label="Send leads" tone="field" onClose={onClose} expandedMax="min(68dvh, 36rem)" peekHeight={112}>
        <div className="send-leads px-4 pb-4">
          <h2>Send leads</h2>
          <p>Houses marked Lead go to one place. The link or key stays on the server.</p>
          {signedIn ? (
            <>
              <div className="mt-3 grid gap-2" role="group" aria-label="Where leads go">
                {CHOICES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={provider === item.id}
                    onClick={() => {
                      setProvider(item.id);
                      setSecret("");
                      setMessage(null);
                      setError(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mt-3">{choice.hint}</p>
              {configured ? <p>A {choice.label} key is saved. Paste a new one only to replace it.</p> : null}
              <label className="mt-2 block">
                {provider === "webhook" ? "Webhook link" : "API key"}
                <input
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  type={provider === "webhook" ? "url" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={provider === "webhook" ? "https://" : "Paste the key"}
                />
              </label>
              {provider === "jobnimbus" ? (
                <div className="mt-2 grid gap-2">
                  <label>
                    Workflow name
                    <input value={recordType} onChange={(event) => setRecordType(event.target.value)} autoComplete="off" />
                  </label>
                  <label>
                    Status name
                    <input value={statusName} onChange={(event) => setStatusName(event.target.value)} autoComplete="off" />
                  </label>
                </div>
              ) : null}
              <div className="mt-3 grid gap-2">
                <button type="button" onClick={() => void save()} disabled={busy !== null}>
                  {busy === "save" ? "Saving…" : "Save"}
                </button>
                <button type="button" onClick={() => void test()} disabled={busy !== null}>
                  {busy === "test" ? "Testing…" : "Test connection"}
                </button>
                <button type="button" onClick={() => void send()} disabled={busy !== null}>
                  {busy === "send" ? "Sending…" : "Send leads"}
                </button>
              </div>
              {message ? (
                <p className="send-leads-ok" role="status">
                  {message}
                </p>
              ) : null}
              {error ? (
                <p className="send-leads-bad" role="alert">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <button type="button" className="mt-3" onClick={onSignIn}>
              Sign in to send leads
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
