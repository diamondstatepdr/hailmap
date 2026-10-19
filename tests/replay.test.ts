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
  frameReplayBounds,
  geometryHitsBounds,
  parseArchiveNames,
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

describe("storm replay map framing", () => {
  it("widens a neighborhood around an address so the storm can move", () => {
    const bounds = frameReplayBounds({ west: -97.4, south: 32.7, east: -97.2, north: 32.8 }, { lat: 32.75, lon: -97.33 });
    expect(bounds.west).toBeLessThan(-98.8);
    expect(bounds.east).toBeGreaterThan(-96.4);
    expect(bounds.south).toBeLessThan(32);
    expect(bounds.north).toBeGreaterThan(33.4);
  });

  it("tightens a national view", () => {
    const bounds = frameReplayBounds({ west: -125, south: 24, east: -66, north: 50 }, null);
    expect(bounds.east - bounds.west).toBeLessThanOrEqual(8);
    expect(bounds.north - bounds.south).toBeLessThanOrEqual(6.5);
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
