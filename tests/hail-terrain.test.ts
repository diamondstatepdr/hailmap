import { describe, expect, it } from "vitest";
import { hailPatches, hillColor, hillMeters } from "@/lib/hail-terrain";

describe("hail terrain", () => {
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
    const foot = hillColor(0.5);
    const summit = hillColor(2.6);
    expect(summit[0]).toBeGreaterThan(foot[0]);
    expect(foot[1]).toBeGreaterThan(summit[1]);
    expect(foot[3]).toBeGreaterThan(0);
    expect(hillColor(0.1)[3]).toBe(0);
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
      expect(patch.columns).toBeLessThanOrEqual(110);
      expect(patch.rows).toBeLessThanOrEqual(110);
    }
  });
});
