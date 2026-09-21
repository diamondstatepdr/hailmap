"use client";

import { useEffect, useRef, useState } from "react";
import type { MapFocus } from "@/components/HailMap";
import type { HailReport } from "@/lib/types";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

const STEPS = ["photo", "pin", "size", "note"] as const;
type Step = (typeof STEPS)[number];

const PRESETS = [
  { id: "0.25", label: "Pea", inches: 0.25 },
  { id: "0.50", label: "Marble", inches: 0.5 },
  { id: "0.75", label: "Dime", inches: 0.75 },
  { id: "1.00", label: "Quarter", inches: 1 },
  { id: "1.25", label: "Half dollar", inches: 1.25 },
  { id: "1.75", label: "Golf ball", inches: 1.75 },
  { id: "2.00", label: "Hen egg", inches: 2 },
  { id: "2.50", label: "Tennis ball", inches: 2.5 },
  { id: "2.75", label: "Baseball", inches: 2.75 },
];

interface Props {
  pin: { lat: number; lon: number } | null;
  onPinChange: (pin: { lat: number; lon: number }) => void;
  onPickingChange: (picking: boolean) => void;
  onFocus: (focus: MapFocus) => void;
  onClose: () => void;
  onSubmitted: (report: HailReport) => void;
}

export default function PhotoReportSheet({
  pin,
  onPinChange,
  onPickingChange,
  onFocus,
  onClose,
  onSubmitted,
}: Props) {
  const [step, setStep] = useState<Step>("photo");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sizeId, setSizeId] = useState("1.00");
  const [customInches, setCustomInches] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const located = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onPickingChange(step === "pin");
  }, [step, onPickingChange]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function chooseFile(next: File | null) {
    setError(null);
    if (!next) return;
    if (next.size > MAX_BYTES) {
      setError("That photo is over 8 MB. Choose a smaller one.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(next);
    const heic = /heic|heif/i.test(next.type) || /\.heic$|\.heif$/i.test(next.name);
    setPreviewUrl(heic ? null : URL.createObjectURL(next));
  }

  function locate() {
    if (!navigator.geolocation) {
      setError("This browser has no location. Tap the map to drop the pin.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = { lat: position.coords.latitude, lon: position.coords.longitude };
        onPinChange(next);
        onFocus({ lon: next.lon, lat: next.lat, nonce: Date.now(), zoom: 12 });
        setLocating(false);
      },
      () => {
        setLocating(false);
        setError("Location is off. Tap the map to drop the pin.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }

  function goToPin() {
    if (!file) {
      setError("Add a photo first.");
      return;
    }
    setError(null);
    setStep("pin");
    if (!located.current) {
      located.current = true;
      locate();
    }
  }

  function inches(): number | null {
    if (sizeId === "custom") {
      const value = Number(customInches);
      if (!Number.isFinite(value) || value <= 0 || value > 8) return null;
      return Math.round(value * 100) / 100;
    }
    return PRESETS.find((preset) => preset.id === sizeId)?.inches ?? null;
  }

  async function submit() {
    if (!file || !pin || submitting) return;
    const sizeIn = inches();
    if (sizeIn == null) {
      setError("Enter a hail size in inches.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("photo", file);
      body.set("lat", String(pin.lat));
      body.set("lon", String(pin.lon));
      body.set("sizeIn", String(sizeIn));
      if (note.trim()) body.set("remark", note.trim());
      const response = await fetch("/api/reports", { method: "POST", body });
      const payload = (await response.json()) as { report?: HailReport; error?: string };
      if (!response.ok || !payload.report) {
        setError(payload.error ?? "Could not save that report");
        setSubmitting(false);
        return;
      }
      onSubmitted(payload.report);
    } catch {
      setError("Could not reach HailMap. Try again.");
      setSubmitting(false);
    }
  }

  const stepIndex = STEPS.indexOf(step);
  const sizeReady = inches() != null;

  return (
    <section className="absolute inset-x-0 bottom-0 z-30" role="dialog" aria-labelledby="photo-report-title">
      <div className="mx-auto w-full max-w-3xl rounded-t-3xl border border-line bg-panel shadow-sheet">
        <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-3">
          <div>
            <p id="photo-report-title" className="text-sm font-semibold">
              Report hail
            </p>
            <p className="text-xs text-muted">
              Step {stepIndex + 1} of {STEPS.length} · community photo
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-line px-3 py-1 text-sm">
            Close
          </button>
        </div>
        <div
          className={`space-y-3 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${
            step === "pin" ? "max-h-[34dvh]" : "max-h-[62dvh]"
          }`}
        >
          {step === "photo" ? (
            <>
              <p className="text-sm text-muted">Take or choose a photo of the hail. The pin on the next step is the location we save.</p>
              {previewUrl ? (
                <img src={previewUrl} alt="Selected hail" className="max-h-48 w-full rounded-2xl object-cover" />
              ) : file ? (
                <p className="rounded-2xl border border-line bg-app px-3 py-4 text-sm">{file.name}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="rounded-2xl bg-accent px-3 py-3 text-sm font-semibold text-accentink"
                >
                  Take photo
                </button>
                <button
                  type="button"
                  onClick={() => libraryRef.current?.click()}
                  className="rounded-2xl border border-line px-3 py-3 text-sm font-semibold"
                >
                  Choose photo
                </button>
              </div>
              <input
                ref={cameraRef}
                type="file"
                accept={ACCEPT}
                capture="environment"
                className="hidden"
                onChange={(event) => {
                  chooseFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <input
                ref={libraryRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                  chooseFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={!file}
                onClick={goToPin}
                className="w-full rounded-2xl bg-accent px-3 py-3 text-sm font-semibold text-accentink disabled:opacity-40"
              >
                Next: confirm location
              </button>
            </>
          ) : null}

          {step === "pin" ? (
            <>
              <p className="text-sm text-muted">
                {pin
                  ? "Pin set. Tap the map or drag the marker if it needs to move."
                  : "Tap the map to drop the pin, or use your location."}
              </p>
              <p className="text-sm font-medium">
                {pin ? `${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}` : "No pin yet"}
              </p>
              <button
                type="button"
                onClick={locate}
                disabled={locating}
                className="w-full rounded-2xl border border-line px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {locating ? "Finding location…" : "Use my location"}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setStep("photo")} className="rounded-2xl border border-line px-3 py-2.5 text-sm">
                  Back
                </button>
                <button
                  type="button"
                  disabled={!pin}
                  onClick={() => {
                    setError(null);
                    setStep("size");
                  }}
                  className="rounded-2xl bg-accent px-3 py-2.5 text-sm font-semibold text-accentink disabled:opacity-40"
                >
                  Next: size
                </button>
              </div>
            </>
          ) : null}

          {step === "size" ? (
            <>
              <p className="text-sm text-muted">How big was the hail?</p>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((preset) => {
                  const on = sizeId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setSizeId(preset.id);
                        setError(null);
                      }}
                      className={`rounded-2xl px-2 py-2 text-left text-sm ${
                        on ? "bg-accent font-semibold text-accentink" : "border border-line"
                      }`}
                    >
                      <span className="block">{preset.label}</span>
                      <span className={`block text-xs ${on ? "text-accentink" : "text-muted"}`}>{preset.inches.toFixed(2)} in</span>
                    </button>
                  );
                })}
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">Custom inches</span>
                <input
                  inputMode="decimal"
                  value={customInches}
                  placeholder="1.50"
                  aria-label="Custom hail size in inches"
                  onChange={(event) => {
                    setCustomInches(event.target.value);
                    setSizeId("custom");
                    setError(null);
                  }}
                  className="w-full rounded-xl border border-line bg-app px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setStep("pin")} className="rounded-2xl border border-line px-3 py-2.5 text-sm">
                  Back
                </button>
                <button
                  type="button"
                  disabled={!sizeReady}
                  onClick={() => {
                    if (!sizeReady) {
                      setError("Enter a size between 0 and 8 inches.");
                      return;
                    }
                    setError(null);
                    setStep("note");
                  }}
                  className="rounded-2xl bg-accent px-3 py-2.5 text-sm font-semibold text-accentink disabled:opacity-40"
                >
                  Next: note
                </button>
              </div>
            </>
          ) : null}

          {step === "note" ? (
            <>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Note (optional)</span>
                <textarea
                  value={note}
                  maxLength={500}
                  rows={3}
                  placeholder="Dents, broken glass, where it fell"
                  onChange={(event) => setNote(event.target.value)}
                  className="w-full rounded-xl border border-line bg-app px-3 py-2"
                />
              </label>
              <p className="text-xs text-muted">
                Saved as a community report at the pin you confirmed. Photo GPS is not used. Do not include a name or phone number.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setStep("size")}
                  className="rounded-2xl border border-line px-3 py-2.5 text-sm"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submit()}
                  className="rounded-2xl bg-accent px-3 py-2.5 text-sm font-semibold text-accentink disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Submit report"}
                </button>
              </div>
            </>
          ) : null}

          {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        </div>
      </div>
    </section>
  );
}
