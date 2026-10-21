import { describe, expect, it } from "vitest";
import { unproject } from "@/lib/geo";
import { compassLabel, formatArea, formatMiles, measureGeometry, movingLabel, readoutForSelection, statLine, swathTitle } from "@/lib/swath-measure";

function rectangle(widthKm: number, heightKm: number, originLon = -111.7, originLat = 33.5): GeoJSON.Polygon {
  const corners = [
    [0, 0],
    [widthKm, 0],
    [widthKm, heightKm],
    [0, heightKm],
    [0, 0],
  ].map(([x, y]) => {
    const point = unproject(x, y, originLon, originLat);
    return [point.lon, point.lat];
  });
  return { type: "Polygon", coordinates: [corners] };
}

describe("swath measurements", () => {
  it("measures a 2 mile by 1 mile rectangle", () => {
    const stats = measureGeometry(rectangle(3.218688, 1.609344));
    expect(stats.lengthMi).toBeCloseTo(2, 1);
    expect(stats.widthMi).toBeCloseTo(1, 1);
    expect(stats.areaSqMi).toBeCloseTo(2, 1);
    expect(stats.lengthMi).toBeGreaterThan(stats.widthMi);
    expect(statLine(stats)).toBe("2 mi long · 1 mi wide · 2 sq mi");
  });

  it("subtracts a hole from the area and keeps the outer length", () => {
    const outer = rectangle(3.218688, 3.218688);
    const hole = rectangle(1.609344, 1.609344, unproject(0.8, 0.8, -111.7, 33.5).lon, unproject(0.8, 0.8, -111.7, 33.5).lat);
    const withHole: GeoJSON.Polygon = { type: "Polygon", coordinates: [outer.coordinates[0], hole.coordinates[0]] };
    const solid = measureGeometry(outer);
    const cut = measureGeometry(withHole);
    expect(solid.areaSqMi).toBeCloseTo(4, 1);
    expect(cut.areaSqMi).toBeLessThan(solid.areaSqMi - 0.5);
    expect(cut.lengthMi).toBeCloseTo(solid.lengthMi, 1);
  });

  it("names the direction from the first report to the last and keeps one title", () => {
    expect(compassLabel(70)).toBe("ENE");
    expect(movingLabel(33.5, -111.9, 33.55, -111.6)).toBe("moving ENE");
    expect(movingLabel(33.5, -111.7, 33.5001, -111.7)).toBeNull();
    expect(swathTitle({ source: "reports", minIn: 2, maxIn: 2 })).toBe("2.00 in report swath");
    expect(swathTitle({ source: "mesh", minIn: 1.5, maxIn: 2.1 })).toBe("2.10 in radar hail");
    expect(formatMiles(12.4)).toBe("12 mi");
    expect(formatArea(0.4)).toBe("0.4 sq mi");
  });

  it("splits nested bands and totals the exclusive area", () => {
    const outer = rectangle(8, 4);
    const core = rectangle(2, 1, unproject(3, 1.5, -111.7, 33.5).lon, unproject(3, 1.5, -111.7, 33.5).lat);
    const readout = readoutForSelection(
      {
        geometry: outer,
        minIn: 1.5,
        maxIn: 2.5,
        startedAt: "2026-10-20T22:10:00.000Z",
        endedAt: "2026-10-20T23:05:00.000Z",
        startLat: 33.5,
        startLon: -111.7,
        endLat: 33.56,
        endLon: -111.55,
      },
      [{ geometry: core, properties: { minIn: 2.5 } }],
    );
    expect(readout.bands.map((band) => band.label)).toEqual(['2.5"+', '1.5"']);
    expect(readout.total.areaSqMi).toBeGreaterThan(readout.bands[0].areaSqMi);
    expect(readout.total.areaSqMi).toBeCloseTo(readout.bands[0].areaSqMi + readout.bands[1].areaSqMi, 1);
    expect(readout.total.areaSqMi).toBeLessThan(13.5);
    expect(readout.motion.direction).toBe("moving ENE");
    expect(readout.motion.startedAt).toBe("2026-10-20T22:10:00.000Z");
  });

  it("keeps total length and width at least as large as every band", () => {
    const parent = rectangle(4, 4);
    const barOrigin = unproject(-3, 1.75, -111.7, 33.5);
    const bar = rectangle(10, 0.5, barOrigin.lon, barOrigin.lat);
    const readout = readoutForSelection(
      { geometry: parent, minIn: 1, maxIn: 2.53 },
      [{ geometry: bar, properties: { minIn: 1.5, maxIn: 1.7 } }],
    );
    expect(readout.bands.map((band) => band.label)).toEqual(['1.5"', '1"']);
    const longest = Math.max(...readout.bands.map((band) => band.lengthMi));
    const widest = Math.max(...readout.bands.map((band) => band.widthMi));
    expect(readout.total.lengthMi).toBeGreaterThanOrEqual(longest - 0.05);
    expect(readout.total.widthMi).toBeGreaterThanOrEqual(widest - 0.05);
    const parentBand = readout.bands.find((band) => band.label === '1"');
    expect(parentBand).toBeTruthy();
    expect(readout.total.lengthMi).toBeGreaterThan((parentBand?.lengthMi ?? 0) + 1);
  });
});
