import { describe, expect, it } from "vitest";
import { drapedMeters, hailPatches, hillColor, hillMeters, hillZoomScale, patchesFromPolygons, radarTexture, reliefDome } from "@/lib/hail-terrain";

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
    const blue = hillColor(0.72);
    const green = hillColor(1.1);
    const yellow = hillColor(1.7);
    const orange = hillColor(2);
    const magenta = hillColor(2.5);
    const red = hillColor(2.4);
    const hot = hillColor(4.2);
    expect(orange[0]).toBeGreaterThan(0.85);
    expect(orange[0]).toBeGreaterThan(orange[1]);
    expect(orange[1]).toBeGreaterThan(orange[2]);
    expect(magenta[0]).toBeGreaterThan(0.7);
    expect(magenta[2]).toBeGreaterThan(magenta[1]);
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
    expect(blue[3]).toBeLessThan(0.4);
    expect(red[3]).toBeGreaterThan(0.55);
    expect(red[3]).toBeLessThan(0.7);
    expect(hillColor(0.45)[3]).toBe(0);
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
    expect(Math.max(...merged[0].values)).toBeGreaterThan(2.2);
    const hotCells = merged[0].values.filter((value) => value >= 2.2).length;
    expect(hotCells).toBeGreaterThan(4);
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

  it("rounds a long rectangular footprint so the edge is not a straight run", () => {
    const patches = patchesFromPolygons([
      {
        geometry: {
          type: "Polygon",
          coordinates: [[
            [-88.5, 41.08],
            [-87.55, 41.08],
            [-87.55, 41.22],
            [-88.5, 41.22],
            [-88.5, 41.08],
          ]],
        },
        properties: { maxSizeIn: 2.48, minIn: 1.4 },
      },
    ]);
    expect(patches).toHaveLength(1);
    const patch = patches[0];
    expect(Math.max(...patch.values)).toBeGreaterThan(2.3);
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (let y = 0; y < patch.rows; y += 1) {
      for (let x = 0; x < patch.columns; x += 1) {
        if ((patch.values[y * patch.columns + x] ?? 0) < 0.5) continue;
        const lon = patch.west + x * patch.step;
        const lat = patch.south + y * patch.step;
        west = Math.min(west, lon);
        east = Math.max(east, lon);
        south = Math.min(south, lat);
        north = Math.max(north, lat);
      }
    }
    expect(west).toBeGreaterThan(-88.5 - 0.12);
    expect(east).toBeLessThan(-87.55 + 0.12);
    expect(south).toBeGreaterThan(41.08 - 0.12);
    expect(north).toBeLessThan(41.22 + 0.12);
    const hot = patch.values.filter((value) => value >= 2.2).length;
    expect(hot).toBeGreaterThan(8);
    const tops: number[] = [];
    for (let x = 0; x < patch.columns; x += 1) {
      let top = -1;
      for (let y = 0; y < patch.rows; y += 1) {
        if ((patch.values[y * patch.columns + x] ?? 0) > 0.35) top = y;
      }
      if (top >= 0) tops.push(top);
    }
    const mid = tops.slice(Math.floor(tops.length * 0.3), Math.floor(tops.length * 0.7));
    const mean = mid.reduce((sum, value) => sum + value, 0) / mid.length;
    const bend = Math.max(...mid.map((value) => Math.abs(value - mean)));
    expect(bend).toBeGreaterThan(0.5);
    const ends = [tops[1] ?? 0, tops[tops.length - 2] ?? 0];
    expect(Math.max(...ends)).toBeLessThan(mean - 0.5);
  });

  it("keeps a lone report a low bump and the fringe on the ground", () => {
    const radius = 2500;
    expect(drapedMeters(2.5, radius, 0)).toBe(0);
    const bump = drapedMeters(2.5, radius, 1);
    expect(bump).toBeGreaterThan(radius * 0.15);
    expect(bump).toBeLessThan(radius * 0.25);
    expect(drapedMeters(1, radius, 1)).toBeLessThan(bump);
    const columns = 16;
    const rows = 16;
    const values = Array.from({ length: columns * rows }, (_, index) => {
      const x = index % columns;
      const y = Math.floor(index / columns);
      return x > 3 && x < 12 && y > 3 && y < 12 ? 1.8 : 0;
    });
    const { dome, inradiusM } = reliefDome({ west: -112, south: 33, step: 0.02, columns, rows, values });
    const center = dome[8 * columns + 8] ?? 0;
    const corner = dome[0] ?? 0;
    const shoulder = dome[8 * columns + 10] ?? 0;
    expect(center).toBeGreaterThan(0.8);
    expect(shoulder).toBeLessThan(center * 0.82);
    expect(corner).toBeLessThan(0.2);
    const crest = drapedMeters(1.8, inradiusM, center);
    expect(crest).toBeGreaterThan(inradiusM * 0.12);
    expect(crest).toBeLessThan(inradiusM * 0.25);
    let tallestStep = 0;
    for (let x = 4; x < 12; x += 1) {
      const left = drapedMeters(1.8, inradiusM, dome[8 * columns + x] ?? 0);
      const right = drapedMeters(1.8, inradiusM, dome[8 * columns + x + 1] ?? 0);
      tallestStep = Math.max(tallestStep, Math.abs(left - right));
    }
    expect(tallestStep).toBeLessThan(inradiusM * 0.08);
  });

  it("turns a hard cell step into a ramp several texels wide", () => {
    const columns = 12;
    const rows = 8;
    const values: number[] = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) values.push(x < 6 ? 2.2 : 0);
    }
    const texture = radarTexture({ west: -88, south: 41, step: 0.04, columns, rows, values });
    expect(texture.width).toBeGreaterThan(columns * 2);
    const mid = Math.floor(texture.height / 2);
    let leaving = -1;
    let gone = -1;
    for (let x = 0; x < texture.width; x += 1) {
      const inches = (texture.rgba[(mid * texture.width + x) * 4] ?? 0) / 255 * 6;
      if (leaving < 0 && inches < 1.6) leaving = x;
      if (inches < 0.35) {
        gone = x;
        break;
      }
    }
    expect(gone - leaving).toBeGreaterThan(4);
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
