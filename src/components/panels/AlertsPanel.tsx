"use client";

import { useEffect, useState } from "react";
import { Bell, BellRing, MapPin, Trash2 } from "lucide-react";
import AddressSearch, { type AddressHit } from "@/components/AddressSearch";
import WatchFields from "@/components/alerts/WatchFields";
import { clearDeviceKey, deviceHeaders, enablePush, iosNeedsHomeScreen, storedDeviceKey } from "@/components/alerts/push";
import {
  DEFAULT_PREFS,
  US_STATES,
  formatInches,
  isIanaTimeZone,
  stateName,
  timeZoneName,
  type WatchKind,
} from "@/lib/alert-model";

interface Settings {
  timeZone: string;
  quietStart: string | null;
  quietEnd: string | null;
  lat: number | null;
  lon: number | null;
  locationAt: string | null;
}

interface Area {
  id: string;
  kind: WatchKind;
  label: string;
  lat: number | null;
  lon: number | null;
  radiusMi: number;
  state: string | null;
  minSizeIn: number;
  mesh: boolean;
  reports: boolean;
  warnings: boolean;
  outlook: boolean;
}

interface InboxItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  place: string;
  sizeIn: number | null;
  occurredAt: string;
  url: string;
  status: string;
  createdAt: string;
}

interface Props {
  onOpenAlert: (url: string) => void;
}

type DraftMode = "address" | "near" | "state";

export default function AlertsPanel({ onOpenAlert }: Props) {
  const [ready, setReady] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<DraftMode>("address");
  const [picked, setPicked] = useState<AddressHit | null>(null);
  const [stateCode, setStateCode] = useState("TX");
  const [radiusMi, setRadiusMi] = useState(25);
  const [minSizeIn, setMinSizeIn] = useState(DEFAULT_PREFS.minSizeIn);
  const [mesh, setMesh] = useState(true);
  const [reports, setReports] = useState(true);
  const [warnings, setWarnings] = useState(true);
  const [outlook, setOutlook] = useState(false);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [iosHint, setIosHint] = useState(false);

  async function refresh() {
    const key = storedDeviceKey();
    if (!key) {
      setSubscribed(false);
      setReady(true);
      return;
    }
    const response = await fetch("/api/alerts/state", { headers: deviceHeaders() });
    if (response.status === 401) {
      clearDeviceKey();
      setSubscribed(false);
      setReady(true);
      return;
    }
    const payload = (await response.json()) as { settings?: Settings; areas?: Area[]; inbox?: InboxItem[]; error?: string };
    if (!response.ok) {
      setError(payload.error ?? "Could not load alerts");
      setReady(true);
      return;
    }
    const phoneZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let settings = payload.settings ?? null;
    if (settings && isIanaTimeZone(phoneZone) && settings.timeZone !== phoneZone) {
      const saved = await fetch("/api/alerts/settings", {
        method: "PATCH",
        headers: deviceHeaders(),
        body: JSON.stringify({ timeZone: phoneZone }),
      });
      if (saved.ok) {
        const updated = (await saved.json()) as { settings?: Settings };
        settings = updated.settings ?? { ...settings, timeZone: phoneZone };
      }
    }
    setSubscribed(true);
    setSettings(settings);
    setAreas(payload.areas ?? []);
    setInbox(payload.inbox ?? []);
    setQuietStart(settings?.quietStart ?? "");
    setQuietEnd(settings?.quietEnd ?? "");
    setReady(true);
  }

  useEffect(() => {
    setIosHint(iosNeedsHomeScreen());
    void refresh().catch(() => setReady(true));
    const onPush = () => void refresh();
    window.addEventListener("hailmap-push", onPush);
    return () => window.removeEventListener("hailmap-push", onPush);
  }, []);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      await enablePush();
      setNotice("Alerts are on for this phone.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not turn alerts on");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/alerts/subscribe", { method: "DELETE", headers: deviceHeaders() });
      const registration = await navigator.serviceWorker?.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
      clearDeviceKey();
      setSubscribed(false);
      setAreas([]);
      setInbox([]);
      setNotice("Alerts are off on this phone.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not turn alerts off");
    } finally {
      setBusy(false);
    }
  }

  async function addWatch() {
    setBusy(true);
    setError(null);
    try {
      if (!storedDeviceKey()) await enablePush();
      const body: Record<string, unknown> = { radiusMi, minSizeIn, mesh, reports, warnings, outlook };
      if (mode === "state") {
        body.kind = "state";
        body.state = stateCode;
        body.label = stateName(stateCode);
      } else if (mode === "near") {
        const position = await locate();
        body.kind = "near";
        body.label = "Near me";
        body.lat = position.coords.latitude;
        body.lon = position.coords.longitude;
      } else {
        if (!picked) throw new Error("Search an address first");
        body.kind = "point";
        body.label = picked.label;
        body.lat = picked.lat;
        body.lon = picked.lon;
      }
      const response = await fetch("/api/alerts/areas", {
        method: "POST",
        headers: deviceHeaders(),
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not add that watch");
      setPicked(null);
      setNotice("Watch saved on this phone.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add that watch");
    } finally {
      setBusy(false);
    }
  }

  async function saveArea(area: Area) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/alerts/areas/${area.id}`, {
        method: "PATCH",
        headers: deviceHeaders(),
        body: JSON.stringify(area),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update that watch");
      setEditing(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update that watch");
    } finally {
      setBusy(false);
    }
  }

  async function removeArea(id: string) {
    const response = await fetch(`/api/alerts/areas/${id}`, { method: "DELETE", headers: deviceHeaders() });
    if (response.ok) setAreas((current) => current.filter((area) => area.id !== id));
  }

  async function saveQuiet() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/alerts/settings", {
        method: "PATCH",
        headers: deviceHeaders(),
        body: JSON.stringify({
          quietStart: quietStart || null,
          quietEnd: quietEnd || null,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save quiet hours");
      setNotice("Quiet hours saved.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save quiet hours");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/alerts/test", { method: "POST", headers: deviceHeaders() });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Test alert failed");
      setNotice("Test alert sent.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Test alert failed");
    } finally {
      setBusy(false);
    }
  }

  const quietZone = timeZoneName(settings?.timeZone);

  return (
    <div className="page-enter h-full overflow-y-auto px-4 py-5 md:px-8" data-tone="alerts">
      <header className="sheet-band">
        <p className="sheet-kicker">Phone alerts</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Alerts</h1>
        <p className="sheet-sub mt-1 max-w-xl text-sm leading-relaxed">
          Get a ping when hail reaches a spot, a state, or wherever this phone is. No account. One alert per storm cell, with quiet hours if you want them.
        </p>
      </header>
      <div className="max-w-3xl space-y-4">
        {iosHint ? (
          <p className="rounded-2xl border border-line bg-panel px-4 py-3 text-sm leading-relaxed">
            Add to Home Screen to get alerts. In Safari, tap Share, then Add to Home Screen, and open Swathline from that icon.
          </p>
        ) : null}
        {error ? <p className="rounded-2xl border border-line bg-panel px-3 py-2 text-sm text-muted">{error}</p> : null}
        {notice ? <p className="rounded-2xl bg-panel px-3 py-2 text-sm" style={{ background: "var(--accent-soft)" }}>{notice}</p> : null}

        <section className="rounded-[1.25rem] border border-line bg-panel p-4 shadow-[0_1px_2px_rgba(16,36,56,0.04)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl bg-[var(--accent-soft)] text-accent">
                {subscribed ? <BellRing size={20} /> : <Bell size={20} />}
              </span>
              <div>
                <h2 className="text-base font-semibold tracking-tight">{subscribed ? "Alerts are on" : "Turn on alerts"}</h2>
                <p className="mt-0.5 text-sm text-muted">
                  {subscribed ? "This phone can receive hail pings." : "Allow notifications, then pick the places you cover."}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {subscribed ? (
              <>
                <button type="button" className="btn btn-primary press" disabled={busy} onClick={() => void sendTest()}>
                  Send test alert
                </button>
                <button type="button" className="btn btn-secondary press" disabled={busy} onClick={() => void turnOff()}>
                  Turn off
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary press" disabled={busy || iosHint} onClick={() => void turnOn()}>
                <Bell size={16} />
                Enable alerts
              </button>
            )}
          </div>
        </section>

        {subscribed ? (
          <section className="rounded-[1.25rem] border border-line bg-panel p-4">
            <h2 className="text-base font-semibold tracking-tight">Quiet hours</h2>
            <p className="mt-1 text-sm text-muted">
              No pings in this window. The hail still shows up in the inbox. Times use your phone&apos;s time zone
              {quietZone ? ` (${quietZone})` : ""}.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-muted">From</span>
                <input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} className="rounded-xl border border-line bg-panel px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Until</span>
                <input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} className="rounded-xl border border-line bg-panel px-3 py-2" />
              </label>
              <button type="button" className="btn btn-secondary press" disabled={busy} onClick={() => void saveQuiet()}>
                Save
              </button>
            </div>
          </section>
        ) : null}

        <section className="rounded-[1.25rem] border border-line bg-panel p-4">
          <h2 className="text-base font-semibold tracking-tight">Add a watch</h2>
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Watch type">
            {(
              [
                ["address", "Address"],
                ["near", "Near me"],
                ["state", "State"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                onClick={() => setMode(id)}
                className={`press rounded-full px-3 py-1.5 text-sm ${mode === id ? "chip-on" : "chip"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "address" ? (
            <div className="mt-3">
              <AddressSearch onPick={setPicked} placeholder="Address, city, or ZIP" />
              {picked ? <p className="mt-2 text-sm font-medium">{picked.label}</p> : null}
            </div>
          ) : null}
          {mode === "near" ? (
            <p className="mt-3 text-sm text-muted">Uses this phone's latest GPS fix. Hail inside the radius of that spot sends one ping per storm.</p>
          ) : null}
          {mode === "state" ? (
            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-muted">State</span>
              <select value={stateCode} onChange={(event) => setStateCode(event.target.value)} className="w-full max-w-xs rounded-xl border border-line bg-panel px-3 py-2">
                {US_STATES.map((item) => (
                  <option key={item.abbr} value={item.abbr}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="mt-3">
            <WatchFields
              radiusMi={radiusMi}
              minSizeIn={minSizeIn}
              mesh={mesh}
              reports={reports}
              warnings={warnings}
              outlook={outlook}
              showRadius={mode !== "state"}
              onRadius={setRadiusMi}
              onThreshold={setMinSizeIn}
              onToggle={(key) => {
                if (key === "mesh") setMesh((value) => !value);
                if (key === "reports") setReports((value) => !value);
                if (key === "warnings") setWarnings((value) => !value);
                if (key === "outlook") setOutlook((value) => !value);
              }}
            />
          </div>
          <button type="button" className="btn btn-primary press mt-4" disabled={busy || iosHint} onClick={() => void addWatch()}>
            <MapPin size={16} />
            Save watch
          </button>
        </section>

        <section>
          <h2 className="text-base font-semibold tracking-tight">Watch areas</h2>
          {!ready ? <div className="skeleton mt-3 h-24" /> : null}
          {ready && !areas.length ? (
            <div className="empty-state mt-3">
              <p className="text-sm font-semibold text-ink">No watches yet</p>
              <p className="mt-1 text-sm">Add an address, a state, or Near me.</p>
            </div>
          ) : null}
          <ul className="mt-3 space-y-2">
            {areas.map((area) => (
              <li key={area.id} className="rounded-[1.1rem] border border-line bg-panel p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{area.label}</p>
                    <p className="mt-0.5 text-xs text-muted">{areaSummary(area)}</p>
                  </div>
                  <button type="button" className="btn btn-ghost press px-2 py-1 text-xs" onClick={() => void removeArea(area.id)} aria-label={`Delete ${area.label}`}>
                    <Trash2 size={15} />
                    Delete
                  </button>
                </div>
                {editing === area.id ? (
                  <div className="mt-3">
                    <WatchFields
                      radiusMi={area.radiusMi || 25}
                      minSizeIn={area.minSizeIn}
                      mesh={area.mesh}
                      reports={area.reports}
                      warnings={area.warnings}
                      outlook={area.outlook}
                      showRadius={area.kind !== "state"}
                      onRadius={(value) => setAreas((current) => current.map((item) => (item.id === area.id ? { ...item, radiusMi: value } : item)))}
                      onThreshold={(value) => setAreas((current) => current.map((item) => (item.id === area.id ? { ...item, minSizeIn: value } : item)))}
                      onToggle={(key) =>
                        setAreas((current) => current.map((item) => (item.id === area.id ? { ...item, [key]: !item[key] } : item)))
                      }
                    />
                    <button type="button" className="btn btn-primary press mt-3" disabled={busy} onClick={() => void saveArea(area)}>
                      Save changes
                    </button>
                  </div>
                ) : (
                  <button type="button" className="btn btn-secondary press mt-3 px-3 py-1.5 text-xs" onClick={() => setEditing(area.id)}>
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="pb-8">
          <h2 className="text-base font-semibold tracking-tight">Inbox</h2>
          <p className="mt-1 text-sm text-muted">Hail that matched a watch on this phone.</p>
          {ready && !inbox.length ? (
            <div className="empty-state mt-3">
              <p className="text-sm font-semibold text-ink">No alerts yet</p>
              <p className="mt-1 text-sm">A test ping or the next storm will land here.</p>
            </div>
          ) : null}
          <ul className="mt-3 space-y-2">
            {inbox.map((item) => (
              <li key={item.id}>
                <button type="button" className="storm-card" onClick={() => onOpenAlert(item.url)}>
                  <span className="hazard-badge hazard-hail">
                    <Bell size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold">{item.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {item.body}
                      {item.status === "quiet" ? " · held for quiet hours" : ""}
                      {item.status === "failed" ? " · not delivered" : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function areaSummary(area: Area): string {
  const size = area.minSizeIn > 0 ? formatInches(area.minSizeIn) : "Any size";
  const where = area.kind === "state" ? "Whole state" : area.kind === "near" ? `${area.radiusMi} mi near me` : `${area.radiusMi} mi`;
  const types = [
    area.mesh ? "radar" : "",
    area.reports ? "spotter" : "",
    area.warnings ? "warnings" : "",
    area.outlook ? "outlook" : "",
  ].filter(Boolean);
  return `${where} · ${size} · ${types.join(", ") || "no types"}`;
}

function locate(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This phone cannot share location"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Location permission is blocked")), {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60_000,
    });
  });
}
