"use client";

import { useEffect, useState } from "react";
import BottomSheet from "@/components/ui/BottomSheet";
import {
  basisTag,
  captureCount,
  DEFAULT_PRICES,
  dollarRange,
  estimateRange,
  forecastShareText,
  percentLabel,
  sumDollars,
  type ExposureLine,
  type ForecastQuery,
  type JobPrices,
} from "@/lib/forecast";
import { formatArea } from "@/lib/swath-measure";
import {
  CREW_CAPTURE_LABEL,
  CREW_CAPTURE_NOTE,
  ESTIMATE_BADGE,
  ESTIMATE_GUIDE,
  ESTIMATE_METHOD,
  ESTIMATE_SOURCES,
  ESTIMATE_TITLE,
} from "@/lib/forecast-sources";

interface Props {
  label: string;
  query: Omit<ForecastQuery, "selectionHail"> & { selectionHail: number };
  onClose: () => void;
}

function countLine(line: ExposureLine): string {
  const vehicles =
    line.vehicles == null
      ? "Vehicles unavailable"
      : `${line.vehicles.toLocaleString("en-US")} vehicles · ${line.damagedVehicles?.toLocaleString("en-US") ?? 0} damaged (${percentLabel(line.vehicleRate)})`;
  const roofs = `${line.roofs.toLocaleString("en-US")} roofs · ${line.damagedRoofs.toLocaleString("en-US")} damaged (${percentLabel(line.roofRate)})`;
  return `${vehicles} · ${roofs}`;
}

export default function ForecastSheet({ label, query, onClose }: Props) {
  const [prices, setPrices] = useState<JobPrices>(DEFAULT_PRICES);
  const [lines, setLines] = useState<ExposureLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dollars = sumDollars(lines, prices);
  const captureVehicles = dollars.damagedVehicles == null ? null : captureCount(dollars.damagedVehicles);
  const captureRoofs = captureCount(dollars.damagedRoofs);
  const showCapture = (captureVehicles ?? 0) > 0 || captureRoofs > 0;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadNote(null);
    setLines([]);
    void fetch("/api/forecast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { lines?: ExposureLine[]; note?: string | null; error?: string };
        if (cancelled) return;
        if (!response.ok) {
          setLoadNote(payload.error ?? "Could not build that estimate.");
          return;
        }
        setLines(payload.lines ?? []);
        setLoadNote(payload.note ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoadNote("Could not build that estimate.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/forecast/prices")
      .then(async (response) => {
        const payload = (await response.json()) as { prices?: JobPrices };
        if (!cancelled && payload.prices) setPrices(payload.prices);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(key: keyof JobPrices, value: string) {
    const next = Math.round(Number(value));
    setPrices((current) => ({ ...current, [key]: Number.isFinite(next) ? next : current[key] }));
  }

  async function shareEstimate() {
    const text = forecastShareText({
      label,
      pdr: pdrText,
      roof: roofText,
      lines: lines.map((line) => `${line.label}: ${countLine(line)}`),
    });
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: ESTIMATE_TITLE, text });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setSaveNote("Copied. ESTIMATE · GUIDE ONLY");
    } catch {
      setSaveNote(text);
    }
  }

  async function save() {
    setSaving(true);
    setSaveNote(null);
    try {
      const response = await fetch("/api/forecast/prices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prices),
      });
      const payload = (await response.json()) as { error?: string; prices?: JobPrices };
      if (!response.ok) throw new Error(payload.error ?? "Could not save prices");
      if (payload.prices) setPrices(payload.prices);
      setSaveNote("Saved for this team.");
    } catch (error) {
      setSaveNote(error instanceof Error ? error.message : "Could not save prices");
    } finally {
      setSaving(false);
    }
  }

  const pdrText = loading ? "Counting…" : dollars.pdr ? estimateRange(dollars.pdr.low, dollars.pdr.high) : "Unavailable";
  const roofText = loading ? "Counting…" : lines.length ? estimateRange(dollars.roof.low, dollars.roof.high) : "Unavailable";

  return (
    <div className="sheet-dock pointer-events-none absolute inset-x-0 bottom-0 z-30 md:inset-x-3">
      <BottomSheet label={ESTIMATE_TITLE} tone="money" onClose={onClose} expandedMax="min(74dvh, 40rem)" peekHeight={168}>
        <div data-forecast className="px-4 pb-6">
          <div className="forecast-head">
            <h2 className="forecast-title">{ESTIMATE_TITLE}</h2>
            <span className="forecast-badge" data-estimate-badge>
              {ESTIMATE_BADGE}
            </span>
          </div>
          <p className="forecast-place">{label}</p>
          <div className="forecast-totals" data-forecast-totals>
            <div>
              <p>PDR</p>
              <strong>{pdrText}</strong>
            </div>
            <div>
              <p>Roofing</p>
              <strong>{roofText}</strong>
            </div>
          </div>
          <p className="forecast-guide" data-forecast-guide>
            {ESTIMATE_GUIDE}
          </p>
          {loading ? <p className="forecast-assume">Counting Census homes and vehicles in each hail band…</p> : null}
          {!loading && loadNote ? <p className="forecast-assume">{loadNote}</p> : null}
          {!loading && lines.length ? (
            <ul className="forecast-lines">
              {lines.map((line) => {
                const tag = basisTag(line.roofBasis) ?? basisTag(line.vehicleBasis);
                const quiet = line.damagedRoofs === 0 && (line.damagedVehicles == null || line.damagedVehicles === 0);
                const pdr =
                  line.damagedVehicles == null
                    ? null
                    : estimateRange(
                        dollarRange(line.damagedVehicles, prices.pdrLow, prices.pdrHigh).low,
                        dollarRange(line.damagedVehicles, prices.pdrLow, prices.pdrHigh).high,
                      );
                const roof = estimateRange(
                  dollarRange(line.damagedRoofs, prices.roofLow, prices.roofHigh).low,
                  dollarRange(line.damagedRoofs, prices.roofLow, prices.roofHigh).high,
                );
                return (
                  <li key={line.label}>
                    <span className="forecast-line-top">
                      <span className="font-semibold">{line.label}</span>
                      {tag ? <span className="forecast-tag">{tag}</span> : null}
                    </span>
                    <span>
                      {line.areaSqMi > 0 ? `${formatArea(line.areaSqMi)} · ` : ""}
                      {countLine(line)}
                    </span>
                    <span className="text-muted">{quiet ? "No expected damage" : [pdr ? `PDR ${pdr}` : null, `Roofing ${roof}`].filter(Boolean).join(" · ")}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {showCapture ? (
            <div className="forecast-capture" data-forecast-capture>
              <p className="forecast-line-top">
                <span className="font-semibold">{CREW_CAPTURE_LABEL}</span>
                <span className="forecast-tag">assumption</span>
              </p>
              <p>
                {captureVehicles == null ? "Vehicles unavailable" : `${captureVehicles.toLocaleString("en-US")} vehicles`} · {captureRoofs.toLocaleString("en-US")} roofs
              </p>
              <p className="text-muted">
                {captureVehicles != null
                  ? `PDR ${estimateRange(dollarRange(captureVehicles, prices.pdrLow, prices.pdrHigh).low, dollarRange(captureVehicles, prices.pdrLow, prices.pdrHigh).high)} · `
                  : ""}
                Roofing {estimateRange(dollarRange(captureRoofs, prices.roofLow, prices.roofHigh).low, dollarRange(captureRoofs, prices.roofLow, prices.roofHigh).high)}
              </p>
              <p className="forecast-assume">{CREW_CAPTURE_NOTE}</p>
            </div>
          ) : null}
          <section className="forecast-method">
            <p>How this is estimated</p>
            {ESTIMATE_METHOD.map((paragraph) => (
              <p key={paragraph} className="forecast-assume">
                {paragraph}
              </p>
            ))}
            <p className="forecast-sources">
              {ESTIMATE_SOURCES.map((source) => (
                <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                  {source.name}
                </a>
              ))}
            </p>
          </section>
          <div className="forecast-footer">
            <div className="forecast-prices" data-forecast-prices>
              <p>Price settings</p>
              {(
                [
                  ["pdrLow", "PDR low", "per car"],
                  ["pdrHigh", "PDR high", "per car"],
                  ["roofLow", "Roof low", "per roof"],
                  ["roofHigh", "Roof high", "per roof"],
                ] as const
              ).map(([key, name, unit]) => (
                <label key={key}>
                  {name}
                  <span className="forecast-unit">{unit}</span>
                  <span className="forecast-money">
                    <span aria-hidden>$</span>
                    <input inputMode="numeric" value={prices[key]} onChange={(event) => setField(key, event.target.value)} />
                  </span>
                </label>
              ))}
            </div>
            <button type="button" className="btn btn-secondary press mt-2 w-full" data-forecast-share onClick={() => void shareEstimate()}>
              Share estimate
            </button>
            <button type="button" className="btn btn-primary press mt-2 w-full" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save prices for the team"}
            </button>
            {saveNote ? <p className="mt-2 text-xs text-muted">{saveNote}</p> : null}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
