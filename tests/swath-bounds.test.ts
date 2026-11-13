import { describe, expect, it } from "vitest";
import { reportsToSwaths, type SwathPoint } from "@/lib/swath";
import { shouldRetargetSwath, snapSwathCenter, swathBoundsForView, swathQueryBounds } from "@/lib/swath-bounds";

function view(lat: number, lon: number, span: number) {
  const half = span / 2;
  return { west: lon - half, east: lon + half, south: lat - half, north: lat + half };
}

describe("swath bounds across zoom", () => {
  it("keeps one geographic box from a regional zoom through a street zoom", () => {
    const regional = swathBoundsForView(view(39.96, -75.06, 1.2));
    const city = swathBoundsForView(view(39.96, -75.06, 0.35));
    const street = swathBoundsForView(view(40.02, -75.1, 0.07));
    expect(city).toEqual(regional);
    expect(street).toEqual(regional);
    expect(regional.east - regional.west).toBeCloseTo(5, 5);
    expect(regional.north - regional.south).toBeCloseTo(5, 5);
  });

  it("does not retarget the swath while the camera only zooms", () => {
    const anchor = snapSwathCenter({ lat: 39.96, lon: -75.06 });
    expect(shouldRetargetSwath(anchor, view(39.96, -75.06, 1.2))).toBe(false);
    expect(shouldRetargetSwath(anchor, view(40.02, -75.1, 0.07))).toBe(false);
    expect(shouldRetargetSwath(anchor, view(41.4, -73.2, 0.4))).toBe(true);
  });

  it("draws the same polygon for every zoom that shares the box", () => {
    const box = swathQueryBounds(snapSwathCenter({ lat: 39.96, lon: -75.06 }));
    const reports: SwathPoint[] = [
      { id: "west", lat: box.south + 0.6, lon: box.west + 0.6, occurredAt: "2026-11-12T18:00:00.000Z", sizeIn: 1 },
      { id: "core", lat: 39.96, lon: -75.06, occurredAt: "2026-11-12T18:20:00.000Z", sizeIn: 1.75 },
      { id: "east", lat: box.north - 0.6, lon: box.east - 0.6, occurredAt: "2026-11-12T18:40:00.000Z", sizeIn: 1.25 },
    ];
    const onScreenAtStreetZoom = reports.filter((point) => Math.abs(point.lat - 39.96) < 0.12 && Math.abs(point.lon + 75.06) < 0.12);
    expect(onScreenAtStreetZoom.map((point) => point.id)).toEqual(["core"]);
    const footprint = reportsToSwaths(reports);
    const cropped = reportsToSwaths(onScreenAtStreetZoom);
    expect(footprint.features.length).toBeGreaterThan(0);
    expect(JSON.stringify(cropped)).not.toBe(JSON.stringify(footprint));
    expect(swathBoundsForView(view(39.96, -75.06, 0.08))).toEqual(box);
    expect(JSON.stringify(reportsToSwaths(reports))).toBe(JSON.stringify(footprint));
  });
});
