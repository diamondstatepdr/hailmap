import { describe, expect, it } from "vitest";
import { hailPatches, hillColor, hillMeters, hillZoomScale, patchesFromPolygons } from "@/lib/hail-terrain";

describe("hail terrain", () => {
  it("turns a straight hail polygon into a hill that meets the ground", () => {
    const ring = [
      [-87.7, 37.7],
      [-87.4, 37.7],
      [-87.4, 37.95],
      [-87.7, 37.95],
      [-87.7, 37.7],
    ];
    const patches = patchesFromPolygons([
      {
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { maxSizeIn: 1.75, minIn: 1.5 },
      },
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0];
    const peak = Math.max(...patch.values);
    const edge = Math.max(patch.values[0], patch.values[patch.columns - 1], patch.values.at(-1) ?? 0);
    expect(peak).toBeGreaterThan(1.2);
    expect(edge).toBeLessThan(0.2);
  });

  it("slopes from the ground at the edge to a peak over the hardest hail", () => {
    const cells = [];
    for (let y = 0; y < 14; y += 1) {
      for (let x = 0; x < 14; x += 1) {
        const distance = Math.hypot(x - 6.5, y - 6.5);
        const inches = distance < 1.5 ? 3.2 : distance < 4 ? 1.6 : 0.9;
        cells.push({ ix: x + 8, iy: y + 8, inches });
      }
    }
    const patches = hailPatches(cells, { west: -94, south: 36, step: 0.02, nx: 40, ny: 40 });
    expect(patches).toHaveLength(1);
    const patch = patches[0];
    const peak = Math.max(...patch.values);
    const edge = Math.max(patch.values[0], patch.values[patch.columns - 1], patch.values[patch.values.length - 1]);
    expect(peak).toBeGreaterThan(2.4);
    expect(edge).toBeLessThan(0.35);
    expect(hillMeters(peak)).toBeGreaterThan(hillMeters(1));
    expect(hillMeters(0.2)).toBe(0);
    expect(hillMeters(3.4)).toBeLessThan(22000);
    const country = hillZoomScale(5.5) * 2 ** 5.5;
    const regional = hillZoomScale(7.4) * 2 ** 7.4;
    expect(country).toBeLessThan(regional * 0.6);
    const blue = hillColor(0.45);
    const green = hillColor(1.1);
    const yellow = hillColor(1.7);
    const red = hillColor(2.4);
    const hot = hillColor(4.2);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    expect(green[1]).toBeGreaterThan(green[0]);
    expect(yellow[0]).toBeGreaterThan(0.7);
    expect(yellow[1]).toBeGreaterThan(0.6);
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(red[0]).toBeGreaterThan(red[2]);
    expect(hot[0]).toBeGreaterThan(0.9);
    expect(hot[1]).toBeGreaterThan(0.85);
    expect(hot[2]).toBeGreaterThan(0.85);
    expect(blue[3]).toBeGreaterThan(0);
    expect(blue[3]).toBeLessThan(red[3]);
    expect(red[3]).toBeLessThan(0.8);
    expect(hillColor(0.1)[3]).toBe(0);
    expect(hillMeters(6)).toBeLessThan(hillMeters(2.5) * 1.85);
  });

  it("blends overlapping report polygons into one radar field and keeps distant storms apart", () => {
    const box = (west: number, south: number, east: number, north: number, inches: number) => ({
      geometry: {
        type: "Polygon" as const,
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
      },
      properties: { maxSizeIn: inches, minIn: inches },
    });
    const merged = patchesFromPolygons([
      box(-88.2, 41.0, -87.55, 41.55, 1.1),
      box(-87.95, 41.18, -87.7, 41.42, 2.6),
    ]);
    expect(merged).toHaveLength(1);
    expect(Math.max(...merged[0].values)).toBeGreaterThan(2.1);
    const apart = patchesFromPolygons([
      box(-88.2, 41.0, -87.9, 41.25, 1.4),
      box(-84.2, 39.0, -83.9, 39.25, 2.2),
    ]);
    expect(apart).toHaveLength(2);
  });

  it("breaks a round report edge so it is not a perfect mirror", () => {
    const patches = patchesFromPolygons([
      {
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-87.5, 41.1],
            [-87.2, 41.1],
            [-87.2, 41.4],
            [-87.5, 41.4],
            [-87.5, 41.1],
          ]],
        },
        properties: { maxSizeIn: 1.8, minIn: 1.2 },
      },
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0];
    const mid = Math.floor(patch.rows / 2);
    let skew = 0;
    const inset = 2;
    for (let x = inset; x < patch.columns / 2; x += 1) {
      const left = patch.values[mid * patch.columns + x] ?? 0;
      const right = patch.values[mid * patch.columns + (patch.columns - 1 - x)] ?? 0;
      skew += Math.abs(left - right);
    }
    expect(skew).toBeGreaterThan(0.05);
  });

  it("turns distant reports into separate hills", () => {
    const patches = hailPatches(
      [
        { ix: 3, iy: 3, inches: 1.4 },
        { ix: 90, iy: 80, inches: 2.5 },
      ],
      { west: -100, south: 30, step: 0.02, nx: 120, ny: 120 },
    );
    expect(patches).toHaveLength(2);
    expect(Math.max(...patches[0].values)).toBeGreaterThan(1);
    expect(Math.max(...patches[1].values)).toBeGreaterThan(2);
  });

  it("keeps a wide storm small enough to draw on a phone", () => {
    const cells = [];
    for (let y = 0; y < 240; y += 1) {
      for (let x = 0; x < 240; x += 1) {
        if ((x + y) % 2 !== 0) continue;
        cells.push({ ix: x, iy: y, inches: 0.8 + (x % 7) * 0.25 });
      }
    }
    const patches = hailPatches(cells, { west: -105, south: 32, step: 0.02, nx: 240, ny: 240 });
    expect(patches.length).toBeGreaterThan(0);
    for (const patch of patches) {
      expect(patch.columns).toBeLessThanOrEqual(300);
      expect(patch.rows).toBeLessThanOrEqual(300);
    }
  });
});
