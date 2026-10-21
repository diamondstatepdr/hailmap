"use client";

import { useEffect, useState } from "react";
import BottomSheet from "@/components/ui/BottomSheet";
import { DEFAULT_PRICES, moneyLabel, sumDollars, type ForecastLine, type JobPrices } from "@/lib/forecast";

interface Props {
  label: string;
  lines: ForecastLine[];
  onClose: () => void;
}

export default function ForecastSheet({ label, lines, onClose }: Props) {
  const [prices, setPrices] = useState<JobPrices>(DEFAULT_PRICES);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dollars = sumDollars(lines, prices);
  const assumed = lines.some((line) => line.vehicleSource === "assumed" || line.roofSource === "assumed");

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

  async function save() {
    setSaving(true);
    setNote(null);
    try {
      const response = await fetch("/api/forecast/prices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(prices),
      });
      const payload = (await response.json()) as { error?: string; prices?: JobPrices };
      if (!response.ok) throw new Error(payload.error ?? "Could not save prices");
      if (payload.prices) setPrices(payload.prices);
      setNote("Saved for this team.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not save prices");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet-dock pointer-events-none absolute inset-x-0 bottom-0 z-30 md:inset-x-3">
      <BottomSheet label="Storm-to-cash" tone="money" onClose={onClose} expandedMax="min(74dvh, 40rem)" peekHeight={128}>
        <div data-forecast>
          <p className="forecast-kicker">Estimate</p>
          <p className="mt-1 text-lg font-semibold tracking-tight">{label}</p>
          <div className="forecast-totals">
            <div>
              <p>PDR</p>
              <strong>
                {moneyLabel(dollars.pdr.low)}–{moneyLabel(dollars.pdr.high)}
              </strong>
            </div>
            <div>
              <p>Roofing</p>
              <strong>
                {moneyLabel(dollars.roof.low)}–{moneyLabel(dollars.roof.high)}
              </strong>
            </div>
          </div>
          <ul className="forecast-lines">
            {lines.map((line) => (
              <li key={`${line.hailIn}-${line.areaSqMi}`}>
                <span className="font-semibold">{line.label}</span>
                <span>
                  {line.vehicles.toLocaleString("en-US")} vehicles · {line.roofs.toLocaleString("en-US")} roofs
                </span>
                <span className="text-muted">{line.areaSqMi.toFixed(2)} sq mi</span>
              </li>
            ))}
          </ul>
          <p className="forecast-assume">
            Estimate only. Not a bid or an inspection.
            {assumed
              ? " Uncounted bands use 900 vehicles and 450 roofs per square mile. Bands over 40 square miles are left out."
              : " Counts come from this Money Hole."}{" "}
            Dollars use the prices below.
          </p>
          <div className="forecast-prices" data-forecast-prices>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Price settings</p>
            <label>
              PDR low
              <input inputMode="numeric" value={prices.pdrLow} onChange={(event) => setField("pdrLow", event.target.value)} />
            </label>
            <label>
              PDR high
              <input inputMode="numeric" value={prices.pdrHigh} onChange={(event) => setField("pdrHigh", event.target.value)} />
            </label>
            <label>
              Roof low
              <input inputMode="numeric" value={prices.roofLow} onChange={(event) => setField("roofLow", event.target.value)} />
            </label>
            <label>
              Roof high
              <input inputMode="numeric" value={prices.roofHigh} onChange={(event) => setField("roofHigh", event.target.value)} />
            </label>
          </div>
          <button type="button" className="btn btn-primary press mt-2 w-full" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save prices for the team"}
          </button>
          {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
        </div>
      </BottomSheet>
    </div>
  );
}
