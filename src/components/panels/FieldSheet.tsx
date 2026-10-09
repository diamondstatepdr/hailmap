"use client";

import { useState } from "react";
import { Navigation } from "lucide-react";
import { FIELD_DAMAGE_TYPES, PIN_STATUSES, pinStatusLabel, type PinStatus } from "@/lib/field";
import type { PlaceHistory } from "@/lib/place";

interface FieldPinView {
  id: string;
  status: PinStatus;
  note: string | null;
  photos: Array<{ id: string }>;
}

interface Props {
  gpsError: string | null;
  street: string | null;
  streetStatus: "idle" | "loading" | "unavailable" | "ok";
  history: PlaceHistory | null;
  historyError: string | null;
  signedIn: boolean;
  pins: FieldPinView[];
  selectedPinId: string | null;
  onSignIn: () => void;
  onMark: (status: PinStatus, note: string) => void;
  onSelectPin: (id: string) => void;
  onUpload: (pinId: string, file: File, damageType: string, note: string) => Promise<void>;
}

const STATUS_TONE: Record<PinStatus, string> = {
  damage: "hazard-tornado",
  talked: "hazard-wind",
  away: "bg-app text-muted",
  lead: "hazard-hail",
};

export default function FieldSheet({
  gpsError,
  street,
  streetStatus,
  history,
  historyError,
  signedIn,
  pins,
  selectedPinId,
  onSignIn,
  onMark,
  onSelectPin,
  onUpload,
}: Props) {
  const [note, setNote] = useState("");
  const [damageType, setDamageType] = useState<(typeof FIELD_DAMAGE_TYPES)[number]>("hail");
  const [photoNote, setPhotoNote] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const places = uniquePlaces(history);

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
    <div className="sheet max-h-[46dvh] overflow-y-auto px-4 pb-3 pt-1">
      <div className="sheet-handle" />
      <div className="mt-2 flex items-center gap-2">
        <span className="hazard-badge h-8 w-8 hazard-wind">
          <Navigation size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Field</p>
          <p className="truncate text-sm font-semibold">
            {streetStatus === "loading"
              ? "Looking up the street…"
              : street
                ? street
                : streetStatus === "unavailable"
                  ? "Street name is unavailable from the geocoder."
                  : "Waiting for GPS…"}
          </p>
        </div>
      </div>
      {gpsError ? <p className="mt-2 text-sm text-muted">{gpsError}</p> : null}
      {history ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold">
            Damage probability {history.score.level} · {history.score.score}/100
          </span>
          <span className="mt-0.5 block text-xs font-normal text-muted">{history.score.summary}</span>
        </p>
      ) : historyError ? (
        <p className="mt-2 text-sm text-muted">{historyError}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">Score appears when your location is known.</p>
      )}
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
