import { describe, expect, it } from "vitest";
import { buildForecast, dollarRange, geometryAreaSqMi, normalizePrices, sumDollars, DEFAULT_PRICES } from "@/lib/forecast";
import { readPrices, writePrices } from "@/lib/forecast-store";

const square: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-97.34, 32.74],
      [-97.33, 32.74],
      [-97.33, 32.75],
      [-97.34, 32.75],
      [-97.34, 32.74],
    ],
  ],
};

describe("storm-to-cash forecast", () => {
  it("uses a Money Hole count instead of the density assumption", () => {
    const lines = buildForecast({ geometry: square, fallbackHail: 1.75, vehicles: 120, homes: 40 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ hailIn: 1.75, label: '1.5"', vehicles: 120, roofs: 40, vehicleSource: "counted", roofSource: "counted" });
    const dollars = sumDollars(lines, DEFAULT_PRICES);
    expect(dollars.pdr).toEqual(dollarRange(120, 175, 450));
    expect(dollars.roof.low).toBe(40 * 6500);
  });

  it("estimates vehicles and roofs from hail-band area when nothing was counted", () => {
    const heavy: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-97.34, 32.76],
          [-97.33, 32.76],
          [-97.33, 32.77],
          [-97.34, 32.77],
          [-97.34, 32.76],
        ],
      ],
    };
    const lines = buildForecast({
      geometry: square,
      fallbackHail: 1,
      bands: [
        { minIn: 1, geometry: square },
        { minIn: 2.5, geometry: heavy },
      ],
    });
    expect(lines.map((line) => line.label)).toEqual(['2.5"+', '1"']);
    expect(lines[0].vehicleSource).toBe("assumed");
    expect(lines[0].vehicles).toBe(Math.round(lines[0].areaSqMi * 900));
    expect(lines[0].roofs).toBe(Math.round(lines[0].areaSqMi * 450));
    expect(geometryAreaSqMi(square)).toBeGreaterThan(0.3);
    expect(geometryAreaSqMi(square)).toBeLessThan(0.6);
  });

  it("rejects a low price above the high price and saves a team override", () => {
    expect(normalizePrices({ pdrLow: 500, pdrHigh: 100, roofLow: 1, roofHigh: 2 })).toEqual({
      error: "The low price has to be at or under the high price.",
    });
    const saved = writePrices({ pdrLow: 200, pdrHigh: 500, roofLow: 7000, roofHigh: 15000 });
    expect(readPrices()).toEqual(saved);
  });
});
