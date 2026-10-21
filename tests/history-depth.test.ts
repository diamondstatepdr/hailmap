import { describe, expect, it } from "vitest";
import { MESH_INSTANT_START } from "@/lib/history-coverage";
import { groupEvents } from "@/lib/history-place";
import { pickHourlyMeshNames } from "@/lib/mesh-plan";
import { countIsoDays, estimateMeshIndex, MESH_CELL_BYTES, MESH_INDEX_BUDGET_BYTES, MESH_PLANNING_CELLS_PER_DAY, meshStoreDecision } from "@/lib/mesh-budget";
import { sourceCoverage, sourceDetail } from "@/lib/source-coverage";
import { timelineRows, yearlyHail } from "@/lib/yearly-hail";

describe("radar archive extent", () => {
  it("spaces hourly MESH names across the storm day and ignores other files", () => {
    const names = [
      "PrecipRate_00.00_20190820-180000.grib2.gz",
      "MESH_00.50_20190820-120000.grib2.gz",
      "MESH_00.50_20190820-180000.grib2.gz",
      "MESH_00.50_20190821-000000.grib2.gz",
      "MESH_00.50_20190821-060000.grib2.gz",
      "MESH_00.50_20190821-120000.grib2.gz",
      "MESH_00.50_20190821-180000.grib2.gz",
      "MESH_00.50_20190820-060000.grib2.gz",
    ];
    const picked = pickHourlyMeshNames("2019-08-20", names, 4);
    expect(picked).toEqual([
      "MESH_00.50_20190820-120000.grib2.gz",
      "MESH_00.50_20190820-180000.grib2.gz",
      "MESH_00.50_20190821-060000.grib2.gz",
      "MESH_00.50_20190821-120000.grib2.gz",
    ]);
    expect(pickHourlyMeshNames("2019-08-19", ["MESH_00.50_20190820-180000.grib2.gz"], 4)).toEqual([]);
  });
});

describe("mesh index budget", () => {
  it("estimates the coarse index before anything is written and stops when the cap is full", () => {
    const estimate = estimateMeshIndex({ from: MESH_INSTANT_START, to: "2026-10-20", cellsPerDay: 1000 });
    expect(estimate.days).toBe(countIsoDays(MESH_INSTANT_START, "2026-10-20"));
    expect(estimate.bytes).toBe(estimate.days * 1000 * MESH_CELL_BYTES);
    expect(estimate.budgetBytes).toBe(MESH_INDEX_BUDGET_BYTES);
    expect(meshStoreDecision(0, 10)).toBe("store");
    expect(meshStoreDecision(MESH_INDEX_BUDGET_BYTES / MESH_CELL_BYTES, 1)).toBe("stop");
    expect(MESH_PLANNING_CELLS_PER_DAY).toBe(2701);
    const planned = estimateMeshIndex({ from: "2019-08-20", to: "2026-10-20" });
    expect(planned.days).toBe(2619);
    expect(planned.bytes).toBe(2619 * 2701 * MESH_CELL_BYTES);
    expect(planned.withinBudget).toBe(false);
  });
});

describe("address source years", () => {
  it("says which years spotter reports, radar hail, and warnings cover", () => {
    const lines = sourceCoverage({ start: "2014-05-01", end: "2024-05-09" });
    const text = lines.map((line) => `${line.source}: ${line.years}`).join("\n");
    expect(text).toContain("Storm spotter reports: since 1955");
    expect(text).toContain("Radar hail maps: since Aug 2019");
    expect(text).toContain("Warnings: since 1986");
    expect(text).not.toContain("AWS");
    expect(text).not.toContain("Iowa");
    const detail = sourceDetail({ start: "2014-05-01", end: "2024-05-09" });
    expect(detail).toContain("1950");
    expect(detail).toContain("August 2019");
    expect(detail).toContain("2014-05-01");
    expect(detail).toContain("2024-05-09");
    expect(detail).not.toContain("2011-01-01");
  });

  it("builds a yearly hail timeline and hides quiet years on a long range", () => {
    const years = yearlyHail(
      [
        { date: "2014-05-08", spotterMaxIn: 1.75, meshMaxIn: null },
        { date: "2019-09-01", spotterMaxIn: 1, meshMaxIn: 1.25 },
      ],
      "2014-01-01",
      "2019-12-31",
    );
    expect(years[0]).toMatchObject({ year: 2019, maxIn: 1.25, days: 1 });
    expect(years.find((year) => year.year === 2014)).toMatchObject({ maxIn: 1.75, days: 1 });
    expect(years.find((year) => year.year === 2016)?.maxIn).toBeNull();
    expect(timelineRows(years).every((year) => year.maxIn != null)).toBe(false);
    const long = yearlyHail(
      [{ date: "2003-04-01", spotterMaxIn: 1, meshMaxIn: null }],
      "1950-01-01",
      "2026-10-21",
    );
    expect(timelineRows(long).map((year) => year.year)).toEqual([2003]);
  });

  it("marks hail before the radar archive and leaves the 2019 hourly window pending", () => {
    const old = groupEvents(
      [
        {
          id: "old",
          source: "spc-svrgis",
          confidence: "nws",
          hazard: "hail",
          lat: 35.22,
          lon: -97.44,
          sizeIn: 1.75,
          windMph: null,
          efRating: null,
          efRank: -1,
          occurredAt: "2014-05-08T22:00:00.000Z",
          stormDate: "2014-05-08",
          state: "OK",
          location: "Norman",
          county: "Cleveland",
          distanceKm: 1,
        },
      ],
      [],
      new Map(),
    );
    expect(old[0]?.meshStatus).toBe("outside-archive");
    const hourly = groupEvents(
      [
        {
          id: "hourly",
          source: "spc-svrgis",
          confidence: "nws",
          hazard: "hail",
          lat: 35.22,
          lon: -97.44,
          sizeIn: 1,
          windMph: null,
          efRating: null,
          efRank: -1,
          occurredAt: "2019-09-01T22:00:00.000Z",
          stormDate: "2019-09-01",
          state: "OK",
          location: "Norman",
          county: "Cleveland",
          distanceKm: 1,
        },
      ],
      [],
      new Map(),
    );
    expect(hourly[0]?.meshStatus).toBe("pending");
  });
});
