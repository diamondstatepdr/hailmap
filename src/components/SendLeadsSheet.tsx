"use client";

import { useEffect, useState } from "react";
import BottomSheet from "@/components/ui/BottomSheet";
import type { CrmProvider } from "@/lib/crm";
import { formatSentClock } from "@/lib/sent-clock";

interface PublicSettings {
  provider: CrmProvider | null;
  configured: boolean;
  recordType: string;
  statusName: string;
  lastSentAt: string | null;
  lastResult: string | null;
  leadCount: number;
}

const CHOICES: Array<{ id: CrmProvider; label: string }> = [
  { id: "webhook", label: "Zapier" },
  { id: "jobnimbus", label: "JobNimbus" },
  { id: "acculynx", label: "AccuLynx" },
];

function leadLabel(count: number): string {
  return count === 1 ? "Send 1 lead" : `Send ${count} leads`;
}

function lastSentLine(at: string | null, result: string | null): string {
  if (!at) return "Not sent yet.";
  const clock = formatSentClock(at);
  if (!clock) return result ? `Last sent. ${result}` : "Not sent yet.";
  return result ? `Last sent ${clock}. ${result}` : `Last sent ${clock}.`;
}

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
  const [leadCount, setLeadCount] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
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
        setLeadCount(Number(body.leadCount) || 0);
        setLastSentAt(body.lastSentAt);
        setLastResult(body.lastResult);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [signedIn]);

  function applySettings(body: PublicSettings) {
    if (body.provider) setProvider(body.provider);
    setConfigured(Boolean(body.configured));
    if (body.recordType) setRecordType(body.recordType);
    if (body.statusName) setStatusName(body.statusName);
    setLeadCount(Number(body.leadCount) || 0);
    setLastSentAt(body.lastSentAt ?? null);
    setLastResult(body.lastResult ?? null);
  }

  async function reload() {
    const response = await fetch("/api/crm/settings");
    if (!response.ok) return;
    applySettings((await response.json()) as PublicSettings);
  }

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
      applySettings({ ...body, leadCount });
      setMessage("Saved. The key stays on this server.");
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
      await reload();
    } catch {
      setError("Could not send leads.");
    } finally {
      setBusy(null);
    }
  }

  const stepTwo =
    provider === "webhook"
      ? "Paste the Zapier link."
      : provider === "jobnimbus"
        ? "Paste the JobNimbus key."
        : "Paste the AccuLynx key.";

  return (
    <div className="sheet-dock pointer-events-none absolute inset-x-0 bottom-0 z-40">
      <BottomSheet label="Send leads" tone="field" onClose={onClose} expandedMax="min(68dvh, 36rem)" peekHeight={112}>
        <div className="send-leads px-4 pb-4">
          <h2>Send leads</h2>
          <p>Houses marked Lead go to one place.</p>
          {signedIn ? (
            <>
              <ol className="send-steps">
                <li>
                  <p>Where should they go?</p>
                  <div className="send-dest" role="radiogroup" aria-label="Where leads go">
                    {CHOICES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={provider === item.id}
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
                </li>
                <li>
                  <p>{stepTwo}</p>
                  <label>
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
                  {provider === "acculynx" ? <p>A lead needs a street address.</p> : null}
                  {configured ? <p>Saved on this server. Paste a new one only to replace it.</p> : null}
                  {provider === "jobnimbus" ? (
                    <div className="send-extra">
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
                </li>
                <li>
                  <p>Save it, then send.</p>
                  <div className="send-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => void save()} disabled={busy !== null}>
                      {busy === "save" ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void test()} disabled={busy !== null}>
                      {busy === "test" ? "Testing…" : "Test"}
                    </button>
                  </div>
                  <button type="button" className="btn btn-primary send-go" onClick={() => void send()} disabled={busy !== null}>
                    {busy === "send" ? "Sending…" : leadLabel(leadCount)}
                  </button>
                </li>
              </ol>
              <p className="send-last">{lastSentLine(lastSentAt, lastResult)}</p>
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
            <button type="button" className="btn btn-primary send-go" onClick={onSignIn}>
              Sign in to send leads
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
