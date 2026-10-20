"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import WatchFields from "@/components/alerts/WatchFields";
import { deviceHeaders, enablePush, iosNeedsHomeScreen, storedDeviceKey } from "@/components/alerts/push";
import { DEFAULT_PREFS } from "@/lib/alert-model";

interface Props {
  label: string;
  lat: number;
  lon: number;
  onClose: () => void;
  onSaved: () => void;
}

export default function AlertHereSheet({ label, lat, lon, onClose, onSaved }: Props) {
  const [radiusMi, setRadiusMi] = useState(25);
  const [minSizeIn, setMinSizeIn] = useState(DEFAULT_PREFS.minSizeIn);
  const [mesh, setMesh] = useState(DEFAULT_PREFS.mesh);
  const [reports, setReports] = useState(DEFAULT_PREFS.reports);
  const [warnings, setWarnings] = useState(DEFAULT_PREFS.warnings);
  const [outlook, setOutlook] = useState(DEFAULT_PREFS.outlook);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    setIosHint(iosNeedsHomeScreen());
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (!storedDeviceKey()) await enablePush();
      const response = await fetch("/api/alerts/areas", {
        method: "POST",
        headers: deviceHeaders(),
        body: JSON.stringify({
          kind: "point",
          label,
          lat,
          lon,
          radiusMi,
          minSizeIn,
          mesh,
          reports,
          warnings,
          outlook,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (response.status === 401) {
        await enablePush();
        setError("Alerts are on. Tap again to save this watch.");
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "Could not save this watch");
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this watch");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(8,18,28,0.45)]" role="presentation" onClick={onClose}>
      <div className="w-full max-w-md" onClick={(event) => event.stopPropagation()}>
      <BottomSheet label="Alert me here" onClose={onClose} expandedMax="min(85dvh, 40rem)">
        <div className="px-4 pb-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Phone alert</p>
          <h2 id="alert-here-title" className="mt-1 text-lg font-semibold tracking-tight">
            Alert me here
          </h2>
          <p className="mt-1 text-sm text-muted">{label}</p>
        </div>
        {iosHint ? (
          <p className="mt-3 rounded-2xl bg-panel-2 px-3 py-2 text-sm leading-relaxed" style={{ background: "var(--panel-2)" }}>
            Add to Home Screen to get alerts. In Safari, tap Share, then Add to Home Screen. Open HailMap from the icon, then turn alerts on.
          </p>
        ) : (
          <>
            <div className="mt-4">
              <WatchFields
                radiusMi={radiusMi}
                minSizeIn={minSizeIn}
                mesh={mesh}
                reports={reports}
                warnings={warnings}
                outlook={outlook}
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
            {error ? <p className="mt-3 text-sm text-muted">{error}</p> : null}
            <button type="button" className="btn btn-primary press mt-4 w-full" disabled={busy} onClick={() => void save()}>
              <Bell size={16} />
            {busy ? "Saving…" : "Watch this spot"}
          </button>
        </>
        )}
        </div>
      </BottomSheet>
      </div>
    </div>
  );
}
