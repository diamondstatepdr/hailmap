import fs from "node:fs";
import path from "node:path";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

interface IncomeFile {
  source: string;
  table: string;
  variable: string;
  fetchedAt: string;
  incomes: Record<string, number>;
}

let cached: GeoJSON.FeatureCollection | null = null;
let refreshStarted = false;

function censusDir(): string {
  return path.join(process.cwd(), "data", "census");
}

function readIncomeFile(): IncomeFile {
  const file = path.join(censusDir(), "county-income.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as IncomeFile;
}

function quintileBreaks(values: number[]): number[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return [0.2, 0.4, 0.6, 0.8].map((quantile) => sorted[Math.min(sorted.length - 1, Math.floor(quantile * (sorted.length - 1)))]);
}

export function getIncomeGeoJson(): GeoJSON.FeatureCollection {
  if (cached) return cached;
  const topo = JSON.parse(fs.readFileSync(path.join(censusDir(), "counties-10m.json"), "utf8")) as Topology;
  const incomeFile = readIncomeFile();
  const incomes = incomeFile.incomes ?? {};
  const object = topo.objects.counties as GeometryCollection;
  const collection = feature(topo, object) as unknown as GeoJSON.FeatureCollection;
  const breaks = quintileBreaks(Object.values(incomes).filter((value) => value > 0));
  for (const item of collection.features) {
    const fips = String(item.id ?? "").padStart(5, "0");
    const income = incomes[fips] ?? null;
    let quintile = 0;
    if (income != null) {
      quintile = 1;
      for (const boundary of breaks) if (income > boundary) quintile += 1;
    }
    item.properties = { fips, income, quintile };
  }
  cached = collection;
  return collection;
}

async function refreshFromCensus(key: string): Promise<boolean> {
  const years = [2023, 2022, 2021];
  for (const year of years) {
    const url = `https://api.census.gov/data/${year}/acs/acs5?get=NAME,B19013_001E&for=county:*&key=${encodeURIComponent(key)}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000), cache: "no-store" });
      if (!response.ok) continue;
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows) || rows.length < 500) continue;
      const incomes: Record<string, number> = {};
      for (const row of rows.slice(1)) {
        if (!Array.isArray(row)) continue;
        const value = Number(row[1]);
        const state = String(row[2] ?? "");
        const county = String(row[3] ?? "");
        if (state && county && Number.isFinite(value) && value > 0) incomes[`${state}${county}`] = Math.round(value);
      }
      if (Object.keys(incomes).length < 500) continue;
      const payload: IncomeFile = {
        source: `US Census Bureau ACS ${year} 5-year B19013`,
        table: "B19013",
        variable: "B19013_001E",
        fetchedAt: new Date().toISOString().slice(0, 10),
        incomes,
      };
      fs.writeFileSync(path.join(censusDir(), "county-income.json"), JSON.stringify(payload));
      cached = null;
      return true;
    } catch (error) {
      console.error("[hailmap] census refresh", error instanceof Error ? error.message : error);
    }
  }
  return false;
}

/** Refresh the bundled ACS cache once per process when CENSUS_API_KEY is set. */
export function maybeRefreshIncome() {
  const key = process.env.CENSUS_API_KEY?.trim();
  if (!key || refreshStarted) return;
  refreshStarted = true;
  void refreshFromCensus(key);
}
