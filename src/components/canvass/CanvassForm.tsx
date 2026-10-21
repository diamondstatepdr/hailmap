"use client";

import { useEffect, useState, type ReactNode } from "react";
import BottomSheet from "@/components/ui/BottomSheet";
import {
  addressKey,
  CANVASS_COLORS,
  CANVASS_STATUSES,
  canvassStatusLabel,
  matchStop,
  type CanvassRepCount,
  type CanvassStatus,
  type CanvassStop,
} from "@/lib/canvass";

interface Props {
  address: string;
  lat: number;
  lon: number;
  hailIn: number | null;
  signedIn: boolean;
  stops: CanvassStop[];
  counts: CanvassRepCount[];
  saving: boolean;
  error: string | null;
  onSignIn: () => void;
  onSave: (status: CanvassStatus, note: string) => Promise<void>;
  showCounts?: boolean;
}

export default function CanvassForm({
  address,
  lat,
  lon,
  hailIn,
  signedIn,
  stops,
  counts,
  saving,
  error,
  onSignIn,
  onSave,
  showCounts = true,
}: Props) {
  const matched = matchStop(stops, { addressKey: addressKey(address, lat, lon), lat, lon });
  const current = stops.find((stop) => stop.id === matched?.id) ?? null;
  const [status, setStatus] = useState<CanvassStatus | null>(current?.status ?? null);
  const [note, setNote] = useState(current?.note ?? "");

  useEffect(() => {
    const form = document.activeElement?.closest("[data-canvass-form]");
    if (form) return;
    setStatus(current?.status ?? null);
    setNote(current?.note ?? "");
  }, [current?.id, current?.updatedAt, current?.status, current?.note]);

  return (
    <section className="canvass-card" data-canvass-form>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Canvass</p>
          <p className="truncate text-sm font-semibold">{address}</p>
        </div>
        <p className="shrink-0 text-xs font-semibold text-muted">
          {counts.reduce((sum, row) => sum + row.total, 0)} today
          {hailIn != null ? ` · ${hailIn.toFixed(2)} in` : ""}
        </p>
      </div>
      <p className="mt-0.5 text-xs text-muted">Shared with everyone on this team.</p>
      {signedIn && showCounts ? <CanvassCounts counts={counts} /> : null}
      {signedIn ? (
        <>
          <div className="canvass-grid" role="group" aria-label="Canvass status">
            {CANVASS_STATUSES.map((item) => (
              <button
                key={item}
                type="button"
                data-canvass-status={item}
                aria-pressed={status === item}
                className="canvass-status press"
                style={{ ["--canvass" as string]: CANVASS_COLORS[item] }}
                onClick={() => setStatus(item)}
              >
                <span className="canvass-dot" style={{ background: CANVASS_COLORS[item] }} />
                {canvassStatusLabel(item)}
              </button>
            ))}
          </div>
          <label className="mt-2 block text-xs font-semibold text-muted">
            Note
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={1}
              maxLength={500}
              placeholder="Optional"
              className="mt-1 w-full resize-none rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink"
            />
          </label>
          <button
            type="button"
            className="btn btn-primary press mt-2 w-full text-sm"
            disabled={!status || saving}
            onClick={() => {
              if (!status) return;
              void onSave(status, note);
            }}
          >
            {saving ? "Saving…" : current ? "Update this house" : "Save for the team"}
          </button>
          {current ? (
            <p className="mt-1.5 text-xs text-muted">
              {canvassStatusLabel(current.status)} · {current.repName} · {formatStamp(current.updatedAt)}
            </p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-muted">{error}</p> : null}
        </>
      ) : (
        <button type="button" onClick={onSignIn} className="btn btn-primary press mt-2 w-full text-sm">
          Sign in to canvass
        </button>
      )}
    </section>
  );
}

export function CanvassCounts({ counts }: { counts: CanvassRepCount[] }) {
  const total = counts.reduce((sum, row) => sum + row.total, 0);
  return (
    <div className="canvass-counts" data-canvass-counts>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Today · {total} houses</p>
      {counts.length ? (
        <ul className="space-y-1">
          {counts.map((row) => (
            <li key={row.repId} className="canvass-rep">
              <span className="truncate font-semibold text-ink">{row.repName}</span>
              <span className="shrink-0 text-muted">
                {row.total} · {row.interested} interested · {row.signed} signed
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No houses marked today yet.</p>
      )}
    </div>
  );
}

export function CanvassLegend({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="canvass-legend press" onClick={onOpen} data-canvass-legend>
      <span className="font-semibold">Canvass</span>
      <span className="text-muted">{count}</span>
      {CANVASS_STATUSES.map((status) => (
        <span key={status} className="inline-flex items-center" title={canvassStatusLabel(status)}>
          <span className="canvass-dot" style={{ background: CANVASS_COLORS[status] }} />
          <span className="sr-only">{canvassStatusLabel(status)}</span>
        </span>
      ))}
    </button>
  );
}

export function CanvassBoard({
  stops,
  counts,
  selectedId,
  form,
  onSelect,
  onClose,
}: {
  stops: CanvassStop[];
  counts: CanvassRepCount[];
  selectedId: string | null;
  form: ReactNode;
  onSelect: (stop: CanvassStop) => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-dock pointer-events-none absolute inset-x-0 bottom-0 z-40 md:inset-x-3">
      <BottomSheet label="Canvass" tone="field" onClose={onClose} expandedMax="min(70dvh, 36rem)">
        <header className="sheet-band">
          <p className="sheet-kicker">Team canvass</p>
          <p className="truncate text-sm font-semibold">Shared house status</p>
        </header>
        <div className="px-4 pb-4">
          <CanvassCounts counts={counts} />
          <ul className="mt-3 max-h-40 space-y-1 overflow-auto">
            {stops.length ? (
              stops.slice(0, 40).map((stop) => (
                <li key={stop.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(stop)}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left ${selectedId === stop.id ? "bg-panel-2" : ""}`}
                  >
                    <span className="canvass-dot" style={{ background: CANVASS_COLORS[stop.status] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{stop.address}</span>
                      <span className="block text-xs text-muted">
                        {canvassStatusLabel(stop.status)} · {stop.repName}
                        {stop.note ? ` · ${stop.note}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="text-sm text-muted">Marks show up here as the team knocks.</li>
            )}
          </ul>
          {selectedId ? <div className="mt-2">{form}</div> : null}
        </div>
      </BottomSheet>
    </div>
  );
}

function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
