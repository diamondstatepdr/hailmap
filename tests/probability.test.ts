import { describe, expect, it } from "vitest";
import { levelForScore, scoreDamage, type ScoreReport } from "@/lib/probability";
import { alertsAtPoint, buildPlaceHistory } from "@/lib/place";
import { damageHeatGrid } from "@/lib/heat";
import type { HailReport } from "@/lib/types";

const NOW = Date.parse("2026-09-21T18:00:00.000Z");

function hail(overrides: Partial<ScoreReport> = {}): ScoreReport {
  return {
    lat: 35.22,
    lon: -97.44,
    occurredAt: "2026-09-21T17:30:00.000Z",
    hazard: "hail",
    confidence: "nws",
    sizeIn: 2,
    ...overrides,
  };
}

describe("damage probability", () => {
  it("maps score bands", () => {
    expect(levelForScore(0)).toBe("Low");
    expect(levelForScore(17)).toBe("Low");
    expect(levelForScore(18)).toBe("Moderate");
    expect(levelForScore(39)).toBe("Moderate");
    expect(levelForScore(40)).toBe("High");
    expect(levelForScore(64)).toBe("High");
    expect(levelForScore(65)).toBe("Very High");
  });

  it("scores close recent large hail as High and explains the factor", () => {
    const score = scoreDamage({
      lat: 35.22,
      lon: -97.44,
      radiusKm: 15,
      now: NOW,
      reports: [hail()],
    });
    expect(score.score).toBe(62);
    expect(score.level).toBe("High");
    expect(score.factors[0].label).toContain("2.00 in hail");
    expect(score.summary).toContain("Not a roof inspection");
  });

  it("keeps a distant older quarter low", () => {
    const score = scoreDamage({
      lat: 35.22,
      lon: -97.44,
      radiusKm: 25,
      now: NOW,
      reports: [
        hail({
          lat: 35.35,
          lon: -97.44,
          sizeIn: 1,
          confidence: "spotter",
          occurredAt: new Date(NOW - 120 * 3600000).toISOString(),
        }),
      ],
    });
    expect(score.level).toBe("Low");
    expect(score.score).toBeGreaterThan(0);
    expect(score.score).toBeLessThan(18);
  });

  it("rates a close EF3 higher than wind, and adds a swath only as coverage", () => {
    const tornado = scoreDamage({
      lat: 35.22,
      lon: -97.44,
      radiusKm: 10,
      now: NOW,
      reports: [hail({ hazard: "tornado", sizeIn: null, efRating: "EF3" })],
    });
    expect(tornado.level).toBe("Very High");
    expect(tornado.score).toBe(76);

    const withSwath = scoreDamage({
      lat: 35.22,
      lon: -97.44,
      radiusKm: 10,
      now: NOW,
      reports: [hail({ sizeIn: 1.75 })],
      swath: { hit: true, maxSizeIn: 1.75 },
    });
    expect(withSwath.score).toBe(64);
    expect(withSwath.factors.some((factor) => factor.id === "swath")).toBe(true);
  });

  it("uses the swath size when no hail report is inside the radius", () => {
    const score = scoreDamage({
      lat: 35.22,
      lon: -97.44,
      radiusKm: 15,
      now: NOW,
      reports: [],
      swath: { hit: true, maxSizeIn: 2 },
    });
    expect(score.score).toBe(34);
    expect(score.level).toBe("Moderate");
  });

  it("says when nothing is in range", () => {
    const score = scoreDamage({ lat: 35, lon: -97, radiusKm: 10, now: NOW, reports: [] });
    expect(score.score).toBe(0);
    expect(score.level).toBe("Low");
    expect(score.factors[0].id).toBe("none");
  });
});

describe("property history", () => {
  it("lists the nearest report and an active warning inside the polygon", () => {
    const report = {
      id: "nws:1",
      source: "spc",
      confidence: "nws" as const,
      hazard: "hail" as const,
      lat: 35.23,
      lon: -97.44,
      sizeIn: 1.5,
      sizeRaw: "1.50",
      windMph: null,
      efRating: null,
      occurredAt: "2026-09-21T16:00:00.000Z",
      location: "Norman",
      county: "Cleveland",
      state: "OK",
      remark: null,
      damageTags: [],
    } satisfies HailReport;
    const warnings: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "warning", event: "Severe Thunderstorm Warning", until: null, hazard: "Hail" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-97.6, 35.1],
                [-97.2, 35.1],
                [-97.2, 35.4],
                [-97.6, 35.4],
                [-97.6, 35.1],
              ],
            ],
          },
        },
      ],
    };
    expect(alertsAtPoint(35.22, -97.44, warnings)).toHaveLength(1);
    expect(alertsAtPoint(34, -97.44, warnings)).toHaveLength(0);
    const history = buildPlaceHistory({
      lat: 35.22,
      lon: -97.44,
      radiusKm: 15,
      hours: 168,
      now: NOW,
      reports: [report],
      warnings,
      warningStatus: "ok",
    });
    expect(history.maxHailIn).toBe(1.5);
    expect(history.nearestKm).toBeGreaterThan(0);
    expect(history.warnings[0].event).toBe("Severe Thunderstorm Warning");
    expect(history.score.score).toBeGreaterThan(0);
  });
});

describe("damage heat grid", () => {
  it("draws a cell where a report exists and skips an empty map", () => {
    const empty = damageHeatGrid([], { now: NOW });
    expect(empty.features).toHaveLength(0);
    const grid = damageHeatGrid([hail()], { now: NOW, cellDegrees: 0.5, radiusKm: 25 });
    expect(grid.features.length).toBeGreaterThan(0);
    expect(grid.features.some((feature) => Number(feature.properties?.score) > 0)).toBe(true);
  });
});
