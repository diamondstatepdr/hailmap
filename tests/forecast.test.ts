import { describe, expect, it } from "vitest";
import { vehiclesFromCensus } from "@/lib/forecast-exposure";
import {
  assignExposure,
  backtestResults,
  bandForHail,
  dollarRange,
  estimateRange,
  forecastShareText,
  moneyLabel,
  normalizePrices,
  percentLabel,
  resolveExposure,
  sumDollars,
  DEFAULT_PRICES,
  type ForecastQuery,
} from "@/lib/forecast";
import {
  COS_AUTO_CLAIMS,
  COS_HOUSING_UNITS,
  COS_PROPERTY_CLAIMS,
  COS_VEHICLES,
  ESTIMATE_BADGE,
  ESTIMATE_GUIDE,
  ESTIMATE_TITLE,
  ROOF_RATE_2IN,
  VEHICLE_RATE_2IN,
} from "@/lib/forecast-sources";
import { readPrices, writePrices } from "@/lib/forecast-store";

const outer: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-111.8, 33.4],
      [-111.6, 33.4],
      [-111.6, 33.6],
      [-111.8, 33.6],
      [-111.8, 33.4],
    ],
    [
      [-111.7, 33.5],
      [-111.65, 33.5],
      [-111.65, 33.55],
      [-111.7, 33.55],
      [-111.7, 33.5],
    ],
  ],
};

const core: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-111.7, 33.5],
      [-111.65, 33.5],
      [-111.65, 33.55],
      [-111.7, 33.55],
      [-111.7, 33.5],
    ],
  ],
};

const swath: ForecastQuery = {
  selection: outer,
  selectionHail: 1,
  selectionIsBand: true,
  bands: [{ minIn: 2.5, geometry: core }],
  vehicles: null,
  homes: null,
};

describe("storm-to-cash estimate", () => {
  it("keeps the screen labeled as a guide", () => {
    expect(ESTIMATE_TITLE).toBe("Storm-to-Cash Estimate");
    expect(ESTIMATE_BADGE).toBe("ESTIMATE · GUIDE ONLY");
    expect(ESTIMATE_GUIDE).toBe("A rough guide based on averages. Not actual damage, claims or earnings.");
    expect(estimateRange(2_300_000, 5_800_000)).toBe("~$2.3M–$5.8M");
    const shared = forecastShareText({ label: "Mesa, AZ", pdr: "~$2.3M–$5.8M", roof: "~$4.7M–$18M", lines: ['1.5": 1,000 vehicles · 40 damaged (4.0%)'] });
    expect(shared).toContain("Storm-to-Cash Estimate");
    expect(shared).toContain("ESTIMATE · GUIDE ONLY");
    expect(shared).toContain("A rough guide based on averages. Not actual damage, claims or earnings.");
    expect(shared).toContain("4.0%");
    expect(moneyLabel(1750)).toBe("$1,750");
    expect(moneyLabel(397_000)).toBe("$397k");
    expect(percentLabel(0)).toBe("0%");
  });

  it("uses sourced zero damage under 1 inch and the 2016 claim share at 2 inches", () => {
    expect(bandForHail(0.75)).toMatchObject({ label: '<1"', vehicleRate: 0, roofRate: 0, roofBasis: "sourced" });
    expect(bandForHail(0.99).roofRate).toBe(0);
    expect(bandForHail(1)).toMatchObject({ roofRate: 0.02, vehicleRate: 0.01, roofBasis: "assumption" });
    expect(bandForHail(1.5).roofBasis).toBe("assumption");
    expect(bandForHail(2).vehicleRate).toBeCloseTo(VEHICLE_RATE_2IN);
    expect(bandForHail(2).roofRate).toBeCloseTo(ROOF_RATE_2IN);
    expect(VEHICLE_RATE_2IN).toBeCloseTo(COS_AUTO_CLAIMS / COS_VEHICLES);
    expect(ROOF_RATE_2IN).toBeCloseTo(COS_PROPERTY_CLAIMS / COS_HOUSING_UNITS);
    expect(bandForHail(2.5).roofBasis).toBe("assumption");
    expect(bandForHail(2.5).roofRate).toBeGreaterThan(ROOF_RATE_2IN);
  });

  it("counts each tract once, in the heaviest band that contains its centroid", () => {
    const lines = assignExposure(swath, [
      { lat: 33.45, lon: -111.75, homes: 100, vehicles: 200 },
      { lat: 33.52, lon: -111.67, homes: 50, vehicles: 80 },
      { lat: 33.45, lon: -111.9, homes: 900, vehicles: 900 },
    ]);
    expect(lines.map((line) => line.label)).toEqual(['2.5"+', '1"']);
    expect(lines[0]).toMatchObject({ roofs: 50, vehicles: 80, roofSource: "census" });
    expect(lines[1]).toMatchObject({ roofs: 100, vehicles: 200 });
    expect(lines.reduce((sum, line) => sum + line.roofs, 0)).toBe(150);
    expect(lines[0].areaSqMi).toBeGreaterThan(0);
    expect(lines[1].areaSqMi).toBeGreaterThan(lines[0].areaSqMi);
    const outerOnly = lines[1].areaSqMi + lines[0].areaSqMi;
    expect(outerOnly).toBeLessThan(180);
    expect(outerOnly).toBeGreaterThan(lines[1].areaSqMi);
    const heavy = lines[0];
    expect(heavy.damagedRoofs).toBe(Math.round(50 * heavy.roofRate));
    expect(heavy.damagedVehicles).toBe(Math.round(80 * (heavy.vehicleRate)));
    const dollars = sumDollars(lines, DEFAULT_PRICES);
    expect(dollars.roof.low).toBe(dollarRange(lines.reduce((sum, line) => sum + line.damagedRoofs, 0), DEFAULT_PRICES.roofLow, DEFAULT_PRICES.roofHigh).low);
    expect(dollars.roof.low).toBeLessThan(150 * DEFAULT_PRICES.roofLow);
  });

  it("uses a Money Hole count only when Census centroids miss the spot", () => {
    const counted = resolveExposure(
      { ...swath, selectionHail: 1.75, selectionIsBand: false, bands: [], vehicles: 120, homes: 40 },
      [],
    );
    expect(counted.exposure).toBe("counted");
    expect(counted.lines[0]).toMatchObject({ label: '1.5"', vehicles: 120, roofs: 40, vehicleSource: "counted" });
    expect(counted.lines[0].damagedVehicles).toBe(Math.round(120 * counted.lines[0].vehicleRate));
    const missed = resolveExposure({ ...swath, vehicles: null, homes: null }, []);
    expect(missed.unavailable).toBe(true);
    expect(missed.lines).toEqual([]);
  });

  it("reads Census vehicle rows and keeps published losses inside the ticket range", () => {
    const parsed = vehiclesFromCensus({
      response: {
        data: [
          ["B25046_001E", "GEO_ID", "NAME"],
          [2939, "1400000US08041000102", "Census Tract 1.02; El Paso County; Colorado"],
          [null, "1400000US08041000103", "Census Tract 1.03; El Paso County; Colorado"],
        ],
      },
    });
    expect(parsed["08041000102"]).toBe(2939);
    expect(parsed["08041000103"]).toBeUndefined();
    const checks = backtestResults();
    expect(checks).toHaveLength(2);
    for (const check of checks) {
      expect(check.total.containsPublished).toBe(true);
      expect(check.total.low).toBeLessThan(check.total.published);
      expect(check.total.high).toBeGreaterThan(check.total.published);
    }
    const springs = checks[0];
    expect(springs.auto.containsPublished).toBe(true);
    expect(springs.property.containsPublished).toBe(true);
    expect(estimateRange(springs.total.low, springs.total.high)).toMatch(/^~\$/);
    expect(checks[1].auto.published).toBeNull();
  });

  it("rejects a low price above the high price and saves a team override", () => {
    expect(normalizePrices({ pdrLow: 500, pdrHigh: 100, roofLow: 1, roofHigh: 2 })).toEqual({
      error: "The low price has to be at or under the high price.",
    });
    const saved = writePrices({ pdrLow: 2306, pdrHigh: 5000, roofLow: 4699, roofHigh: 17631 });
    expect(readPrices()).toEqual(saved);
    expect(DEFAULT_PRICES).toMatchObject({ pdrLow: 2306, pdrHigh: 5000, roofLow: 4699, roofHigh: 17631 });
  });
});
