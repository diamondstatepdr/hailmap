import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import {
  activeWindow,
  archiveAtOrBefore,
  archiveStamp,
  clipCells,
  convectiveWindow,
  dayHailCells,
  formatReplayClock,
  formatReplayClockParts,
  hailReportTicks,
  frameReplayBounds,
  geometryHitsBounds,
  loadedFrameIndex,
  parseArchiveNames,
  prefetchFrameTimes,
  replayFrames,
  stormTimeZone,
  warningActive,
} from "@/lib/replay-time";
import { DEFAULT_MESH_SHAPE, type MeshCell } from "@/lib/mesh-contour";

describe("storm replay timing", () => {
  it("keeps a convective day inside 12:00 UTC to 12:00 UTC", () => {
    const window = convectiveWindow("2024-05-09", new Date("2026-01-01T00:00:00Z"));
    expect(window.start).toBe("2024-05-09T12:00:00.000Z");
    expect(window.end).toBe("2024-05-10T12:00:00.000Z");
  });

  it("stops a live day at the current time", () => {
    const window = convectiveWindow("2026-10-19", new Date("2026-10-19T18:30:00Z"));
    expect(window.end).toBe("2026-10-19T18:30:00.000Z");
  });

  it("aligns frames to 15-minute clock times", () => {
    const frames = replayFrames("2024-05-09T16:12:00.000Z", "2024-05-09T17:05:00.000Z", 15);
    expect(frames).toEqual([
      "2024-05-09T16:15:00.000Z",
      "2024-05-09T16:30:00.000Z",
      "2024-05-09T16:45:00.000Z",
      "2024-05-09T17:00:00.000Z",
    ]);
  });

  it("pads the play window around Fort Worth reports and stays inside the convective day", () => {
    const window = convectiveWindow("2024-05-09", new Date("2026-01-01T00:00:00Z"));
    const span = activeWindow(
      [Date.parse("2024-05-09T16:12:00Z"), Date.parse("2024-05-10T00:08:00Z")],
      window,
    );
    expect(span.start).toBe("2024-05-09T15:12:00.000Z");
    expect(span.end).toBe("2024-05-10T00:53:00.000Z");
  });

  it("labels Fort Worth in Central time", () => {
    expect(stormTimeZone(-97.3)).toBe("America/Chicago");
    expect(formatReplayClock("2024-05-09T21:45:00.000Z", "America/Chicago")).toMatch(/4:45\s*PM/);
    const parts = formatReplayClockParts("2024-05-09T21:45:00.000Z", "America/Chicago");
    expect(parts?.time).toBe("4:45");
    expect(parts?.period).toMatch(/PM/);
    expect(parts?.zone).toMatch(/CDT|CST/);
    expect(parts?.date).toMatch(/May 9/);
  });

  it("places hail reports as scrubber ticks and skips wind", () => {
    const frames = ["2024-05-09T21:00:00.000Z", "2024-05-09T22:00:00.000Z", "2024-05-09T23:00:00.000Z"];
    const ticks = hailReportTicks(frames, [
      { occurredAt: "2024-05-09T21:00:00.000Z", hazard: "hail" },
      { occurredAt: "2024-05-09T21:02:00.000Z", hazard: "hail" },
      { occurredAt: "2024-05-09T22:00:00.000Z", hazard: "wind" },
      { occurredAt: "2024-05-09T23:00:00.000Z", hazard: "hail" },
    ]);
    expect(ticks[0]).toBe(0);
    expect(ticks).toContain(100);
    expect(ticks.some((tick) => tick > 40 && tick < 60)).toBe(false);
    expect(ticks.length).toBe(2);
  });

  it("prefetches the playhead and the next three steps", () => {
    const frames = ["a", "b", "c", "d", "e", "f", "g"];
    expect(prefetchFrameTimes(frames, 1, 15)).toEqual(["b", "c", "d", "e"]);
    expect(prefetchFrameTimes(frames, 5, 15)).toEqual(["f", "g"]);
    expect(prefetchFrameTimes(frames, 0, 60)).toEqual(["a", "e"]);
  });

  it("keeps the visible frame on the latest loaded swath at or before the playhead", () => {
    const frames = ["a", "b", "c", "d"];
    const ready = new Set(["a", "b"]);
    expect(loadedFrameIndex(frames, 3, (at) => ready.has(at))).toBe(1);
    expect(loadedFrameIndex(frames, 1, (at) => ready.has(at))).toBe(1);
    expect(loadedFrameIndex(frames, 0, () => false)).toBe(-1);
  });
});

describe("storm replay radar", () => {
  it("keeps hail that rose after the 12:00 UTC baseline and drops yesterday's swath", () => {
    const baseline: MeshCell[] = [
      { ix: 1, iy: 1, inches: 1.5 },
      { ix: 2, iy: 2, inches: 0.8 },
    ];
    const current: MeshCell[] = [
      { ix: 1, iy: 1, inches: 1.5 },
      { ix: 2, iy: 2, inches: 2.4 },
      { ix: 3, iy: 3, inches: 1.1 },
    ];
    expect(dayHailCells(baseline, current).map((cell) => [cell.ix, cell.inches])).toEqual([
      [2, 2.4],
      [3, 1.1],
    ]);
  });

  it("clips cells to a metro box", () => {
    const cells: MeshCell[] = [
      { ix: 1600, iy: 640, inches: 2 },
      { ix: 10, iy: 10, inches: 2 },
    ];
    const kept = clipCells(cells, DEFAULT_MESH_SHAPE, { west: -98.2, south: 32.4, east: -96.8, north: 33.2 });
    expect(kept).toHaveLength(1);
    expect(kept[0].ix).toBe(1600);
  });

  it("picks the archive file at or before the playhead", () => {
    const html = `
      <a href="MESH_Max_1440min_00.50_20240509-210000.grib2.gz">a</a>
      <a href="MESH_Max_1440min_00.50_20240509-213000.grib2.gz">b</a>
      <a href="MESH_Max_1440min_00.50_20240509-210000.grib2.gz">a</a>
    `;
    const names = parseArchiveNames(html);
    expect(names).toHaveLength(2);
    const target = Date.parse("2024-05-09T21:20:00Z");
    expect(archiveAtOrBefore(names, target, 40 * 60 * 1000)).toBe("MESH_Max_1440min_00.50_20240509-210000.grib2.gz");
    expect(archiveStamp("MESH_00.50_20240509-210200.grib2.gz")).toBe(Date.parse("2024-05-09T21:02:00Z"));
  });
});

function spanKm(bounds: { west: number; south: number; east: number; north: number }) {
  const mid = (bounds.north + bounds.south) / 2;
  return {
    latKm: (bounds.north - bounds.south) * 111.32,
    lonKm: (bounds.east - bounds.west) * 111.32 * Math.cos((mid * Math.PI) / 180),
  };
}

describe("storm replay map framing", () => {
  it("frames a Fort Worth address at metro scale and keeps the city inside", () => {
    const bounds = frameReplayBounds({ west: -97.4, south: 32.7, east: -97.2, north: 32.8 }, { lat: 32.75, lon: -97.33 });
    const span = spanKm(bounds);
    expect(span.latKm).toBeGreaterThan(60);
    expect(span.latKm).toBeLessThanOrEqual(100);
    expect(span.lonKm).toBeGreaterThan(60);
    expect(span.lonKm).toBeLessThanOrEqual(100);
    expect(bounds.south).toBeLessThan(32.75);
    expect(bounds.north).toBeGreaterThan(32.75);
    expect(bounds.west).toBeLessThan(-97.33);
    expect(bounds.east).toBeGreaterThan(-97.33);
    expect(bounds.north - bounds.south).toBeLessThan(1.2);
  });

  it("tightens a national view to the same metro window", () => {
    const bounds = frameReplayBounds({ west: -125, south: 24, east: -66, north: 50 }, null);
    const span = spanKm(bounds);
    expect(span.latKm).toBeGreaterThan(60);
    expect(span.latKm).toBeLessThanOrEqual(100);
    expect(span.lonKm).toBeGreaterThan(60);
    expect(span.lonKm).toBeLessThanOrEqual(100);
  });

  it("shifts a Fort Worth replay toward nearby hail without leaving the city or metro scale", () => {
    const bounds = frameReplayBounds(null, { lat: 32.753, lon: -97.333 }, [
      { lat: 32.36, lon: -97.66 },
      { lat: 32.44, lon: -97.8 },
    ]);
    const span = spanKm(bounds);
    expect(span.latKm).toBeGreaterThan(60);
    expect(span.latKm).toBeLessThanOrEqual(100);
    expect(span.lonKm).toBeLessThanOrEqual(100);
    expect(bounds.south).toBeLessThan(32.36);
    expect(bounds.north).toBeGreaterThan(32.753);
    expect(bounds.west).toBeLessThan(-97.8);
    expect(bounds.east).toBeGreaterThan(-97.333);
  });

  it("keeps a view that is already metro sized", () => {
    const bounds = frameReplayBounds({ west: -97.7, south: 32.4, east: -96.9, north: 33.1 }, null);
    const span = spanKm(bounds);
    expect(span.latKm).toBeGreaterThan(70);
    expect(span.latKm).toBeLessThan(100);
    expect(bounds.south).toBeCloseTo(32.4, 2);
    expect(bounds.north).toBeCloseTo(33.1, 2);
  });

  it("treats a warning as active only inside its polygon window", () => {
    expect(warningActive("2024-05-09T21:00:00Z", "2024-05-09T21:45:00Z", Date.parse("2024-05-09T21:10:00Z"))).toBe(true);
    expect(warningActive("2024-05-09T21:00:00Z", "2024-05-09T21:45:00Z", Date.parse("2024-05-09T21:45:00Z"))).toBe(false);
    const polygon: Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-97.5, 32.6],
          [-97.1, 32.6],
          [-97.1, 32.9],
          [-97.5, 32.9],
          [-97.5, 32.6],
        ],
      ],
    };
    expect(geometryHitsBounds(polygon, { west: -97.4, south: 32.7, east: -97.2, north: 32.8 })).toBe(true);
    expect(geometryHitsBounds(polygon, { west: -90, south: 40, east: -89, north: 41 })).toBe(false);
  });
});
