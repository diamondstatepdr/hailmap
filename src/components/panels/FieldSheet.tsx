"use client";

import { useState } from "react";
import { CarFront } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import type { DealerPin } from "@/lib/area-selection";
import { fieldScoreCopy, fieldStreetTitle } from "@/lib/field-status";
import { FIELD_DAMAGE_TYPES, PIN_STATUSES, pinStatusLabel, type PinStatus } from "@/lib/field";
import type { PlaceHistory } from "@/lib/place";
import { topScoreFactors } from "@/lib/probability";
import { formatMiles } from "@/lib/units";

interface FieldPinView {
  id: string;
  status: PinStatus;
  note: string | null;
  photos: Array<{ id: string }>;
}

interface Props {
  gpsError: string | null;
  locationOn: boolean;
  onMyLocation: () => void;
  onCenterOnMe: () => void;
  street: string | null;
  streetStatus: "idle" | "loading" | "unavailable" | "ok";
  lat: number | null;
  lon: number | null;
  waitedMs: number;
  windowLabel: string;
  history: PlaceHistory | null;
  historyError: string | null;
  signedIn: boolean;
  pins: FieldPinView[];
  selectedPinId: string | null;
  areaLabel: string | null;
  dealers: DealerPin[];
  dealerLoading: boolean;
  dealerNote: string | null;
  dealerError: string | null;
  selectedDealerId: string | null;
  onSearchArea: () => void;
  onWiden: () => void;
  onSelectDealer: (id: string) => void;
  onSignIn: () => void;
  onMark: (status: PinStatus, note: string) => void;
  onSelectPin: (id: string) => void;
  onUpload: (pinId: string, file: File, damageType: string, note: string) => Promise<void>;
  onSendLeads: () => void;
  sendMessage: string | null;
  onClose: () => void;
}

const STATUS_TONE: Record<PinStatus, string> = {
  damage: "hazard-tornado",
  talked: "hazard-wind",
  away: "bg-app text-muted",
  lead: "hazard-hail",
};

export default function FieldSheet({
  gpsError,
  locationOn,
  onMyLocation,
  onCenterOnMe,
  street,
  streetStatus,
  lat,
  lon,
  waitedMs,
  windowLabel,
  history,
  historyError,
  signedIn,
  pins,
  selectedPinId,
  areaLabel,
  dealers,
  dealerLoading,
  dealerNote,
  dealerError,
  selectedDealerId,
  onSearchArea,
  onWiden,
  onSelectDealer,
  onSignIn,
  onMark,
  onSelectPin,
  onUpload,
  onSendLeads,
  sendMessage,
  onClose,
}: Props) {
  const [note, setNote] = useState("");
  const [damageType, setDamageType] = useState<(typeof FIELD_DAMAGE_TYPES)[number]>("hail");
  const [photoNote, setPhotoNote] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const places = uniquePlaces(history);
  const title = fieldStreetTitle({ street, status: streetStatus, lat, lon, waitedMs });
  const scoreCopy = fieldScoreCopy({ score: history ? history.score.score : null, windowLabel });
  const factors = history ? topScoreFactors(history.score.factors) : [];

  async function upload(file: File | null) {
    if (!file || !selectedPinId) return;
    setUploading(true);
    setPhotoError(null);
    try {
      await onUpload(selectedPinId, file, damageType, photoNote);
      setPhotoNote("");
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "Could not save that photo");
    } finally {
      setUploading(false);
    }
  }

  return (
    <BottomSheet label="Field" tone="field" onClose={onClose} expandedMax="min(62dvh, 36rem)" peekHeight={120}>
      <header className="sheet-band">
        <p className="sheet-kicker">Field</p>
        <p className="truncate text-sm font-semibold" data-field-street>
          {title}
        </p>
      </header>
      <div className="px-4 pb-3">
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onMyLocation} className="btn btn-secondary press text-sm">
          {gpsError ? "Location is blocked" : locationOn ? "Location on" : "My location"}
        </button>
        <button type="button" onClick={onCenterOnMe} className="btn btn-secondary press text-sm">
          Center on me
        </button>
      </div>
      {gpsError ? <p className="mt-2 text-sm text-muted">{gpsError}</p> : null}
      {scoreCopy.showScore && history ? (
        <div className="mt-2 text-sm">
          <p className="font-semibold">
            Damage probability {history.score.level} · {history.score.score}/100
          </p>
          {factors.length ? (
            <ul className="mt-1 space-y-1">
              {factors.map((factor) => (
                <li key={factor.id} className="text-xs leading-relaxed text-muted">
                  <span className="font-semibold text-ink">{factor.label}</span> — {factor.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-muted">{historyError ?? scoreCopy.message}</p>
          {history && history.score.score <= 0 ? (
            <button type="button" onClick={onWiden} className="btn btn-secondary press mt-2 w-full text-sm">
              Widen to 90 days
            </button>
          ) : null}
        </div>
      )}
      <div className="mt-3 rounded-2xl border border-line bg-panel-2 p-3" style={{ background: "var(--panel-2)" }}>
        <div className="flex items-center gap-2">
          <span className="hazard-badge h-8 w-8 hazard-hail">
            <CarFront size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Dealerships</p>
            <p className="truncate text-sm font-semibold">{areaLabel ?? "Lots near this stop"}</p>
          </div>
        </div>
        <button type="button" onClick={onSearchArea} disabled={dealerLoading} className="btn btn-primary press mt-2 w-full text-sm disabled:opacity-60">
          {dealerLoading ? "Searching…" : dealerError ? "Try again" : "Find dealerships near this spot"}
        </button>
        {dealerLoading ? <p className="mt-2 text-xs text-muted">Searching OpenStreetMap…</p> : null}
        {dealerError ? <p className="mt-2 text-xs text-muted">{dealerError}</p> : null}
        {dealers.length ? (
          <ul className="mt-2 max-h-36 space-y-1 overflow-auto">
            {dealers.map((dealer) => (
              <li key={dealer.id}>
                <button
                  type="button"
                  onClick={() => onSelectDealer(dealer.id)}
                  className={`w-full rounded-xl px-2 py-1.5 text-left ${selectedDealerId === dealer.id ? "bg-panel font-semibold" : ""}`}
                >
                  <span className="block text-sm">{dealer.name}</span>
                  <span className="block text-xs text-muted">
                    {dealer.kind === "lot" ? "Auto lot" : "Dealership"} · {formatMiles(dealer.distanceKm)}
                  </span>
                  <span className="block text-xs text-muted">{dealer.address}</span>
                </button>
                <span className="dealer-hit-actions px-2">
                  {dealer.phone ? (
                    <a href={`tel:${dealer.phone.replace(/[^\d+]/g, "")}`}>{dealer.phone}</a>
                  ) : null}
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${dealer.lat.toFixed(5)},${dealer.lon.toFixed(5)}&travelmode=driving`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Directions
                  </a>
                </span>
              </li>
            ))}
          </ul>
        ) : dealerNote && !dealerLoading ? (
          <p className="mt-2 text-xs text-muted">{dealerNote}</p>
        ) : null}
      </div>
      <div className="mt-3">
        <p className="text-xs font-semibold text-muted">Nearby reported places</p>
        {places.length ? (
          <ul className="mt-1 flex flex-wrap gap-1">
            {places.map((place) => (
              <li key={place} className="rounded-full bg-app px-2 py-0.5 text-xs">
                {place}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No named report locations in this radius yet.</p>
        )}
      </div>
      {signedIn ? (
        <>
          <label className="mt-3 block text-sm">
            Note
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-app px-3 py-2"
              placeholder="Optional"
            />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {PIN_STATUSES.map((status) => (
              <button key={status} type="button" onClick={() => onMark(status, note)} className={`field-action press ${STATUS_TONE[status]}`}>
                {pinStatusLabel(status)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary press send-lead mt-3 w-full" onClick={onSendLeads}>
            Send leads
          </button>
          {sendMessage ? (
            <p className="send-lead-note" role="status">
              {sendMessage}
            </p>
          ) : null}
          <div className="mt-3">
            <p className="text-xs font-semibold text-muted">Your pins</p>
            {!pins.length ? <p className="text-xs text-muted">No pins yet. Marks stay on your account.</p> : null}
            <ul className="mt-1 max-h-28 overflow-auto text-sm">
              {pins.slice(0, 20).map((pin) => (
                <li key={pin.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPin(pin.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-left ${selectedPinId === pin.id ? "bg-app font-semibold" : ""}`}
                  >
                    <span>
                      {pinStatusLabel(pin.status)}
                      {pin.note ? ` · ${pin.note}` : ""}
                    </span>
                    <span className="text-xs text-muted">{pin.photos.length} photos</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {selectedPinId ? (
            <div className="mt-2 rounded-2xl bg-app p-3">
              <p className="text-sm font-semibold">Add a damage photo</p>
              <p className="text-xs text-muted">Stored on this pin. Not shown as an official report.</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {FIELD_DAMAGE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={damageType === type}
                    onClick={() => setDamageType(type)}
                    className={`rounded-full px-2.5 py-1 text-xs capitalize ${
                      damageType === type ? "chip-on" : "chip shadow-none"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <input
                value={photoNote}
                onChange={(event) => setPhotoNote(event.target.value)}
                placeholder="Photo note"
                className="mt-2 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm"
              />
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="mt-2 block w-full text-sm"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  void upload(file);
                  event.target.value = "";
                }}
              />
              {uploading ? <p className="mt-1 text-xs text-muted">Saving photo…</p> : null}
              {photoError ? <p className="mt-1 text-xs text-muted">{photoError}</p> : null}
            </div>
          ) : null}
        </>
      ) : (
        <button type="button" onClick={onSignIn} className="btn btn-primary press mt-3 w-full">
          Sign in to mark houses
        </button>
      )}
      </div>
    </BottomSheet>
  );
}

function uniquePlaces(history: PlaceHistory | null): string[] {
  const names = new Set<string>();
  for (const report of history?.reports ?? []) {
    const name = report.location || report.county;
    if (name) names.add(name);
    if (names.size >= 8) break;
  }
  return [...names];
}
