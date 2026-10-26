import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import { DEFAULT_PRICES, type JobPrices } from "@/lib/forecast";

export function forecastTeamKey(): string {
  const pass = process.env.HAILMAP_TEAM_PASSCODE || "default";
  return createHash("sha256").update(`swathline-team|${pass}`).digest("hex").slice(0, 24);
}

export function readPrices(): JobPrices {
  const row = getDb()
    .prepare(`SELECT pdr_low, pdr_high, roof_low, roof_high FROM forecast_prices WHERE team_key = ?`)
    .get(forecastTeamKey()) as { pdr_low: number; pdr_high: number; roof_low: number; roof_high: number } | undefined;
  if (!row) return { ...DEFAULT_PRICES };
  return { pdrLow: row.pdr_low, pdrHigh: row.pdr_high, roofLow: row.roof_low, roofHigh: row.roof_high };
}

export function writePrices(prices: JobPrices): JobPrices {
  getDb()
    .prepare(
      `INSERT INTO forecast_prices (team_key, pdr_low, pdr_high, roof_low, roof_high, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(team_key) DO UPDATE SET
         pdr_low = excluded.pdr_low,
         pdr_high = excluded.pdr_high,
         roof_low = excluded.roof_low,
         roof_high = excluded.roof_high,
         updated_at = excluded.updated_at`,
    )
    .run(forecastTeamKey(), prices.pdrLow, prices.pdrHigh, prices.roofLow, prices.roofHigh, new Date().toISOString());
  return prices;
}
