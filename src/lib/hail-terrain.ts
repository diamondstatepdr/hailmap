import { MESH_LEGEND } from "@/lib/mesh-legend";
import type { MeshCell, MeshGridShape } from "@/lib/mesh-contour";

/** One smoothed piece of the hail field. Values are inches, row-major, including a zero skirt. */
export type HailPatch = {
  west: number;
  south: number;
  step: number;
  columns: number;
  rows: number;
  values: number[];
};

const DILATE = 5;
const BLUR_SIGMA = 1.55;

/**
 * Meters of relief at the reference zoom. The foot of the hill stays near the
 * ground and the hardest hail is a modest peak, not a tower.
 */
export function hillMeters(inches: number): number {
  const rise = Math.max(0, inches - 0.22);
  return rise * rise * 42000;
}

const COLOR_STOPS = MESH_LEGEND.map((band) => ({
  inches: band.minIn,
  rgb: [parseInt(band.color.slice(1, 3), 16), parseInt(band.color.slice(3, 5), 16), parseInt(band.color.slice(5, 7), 16)] as [number, number, number],
}));

/** RGBA 0–1. Green at the foot, legend colors up the slope, clear at the ground. */
export function hillColor(inches: number): [number, number, number, number] {
  const rgb = sampleColor(inches);
  if (inches <= 0.2) return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 0];
  const fade = Math.min(1, (inches - 0.2) / 1.7);
  const alpha = 0.34 + 0.5 * fade;
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha];
}

function sampleColor(inches: number): [number, number, number] {
  if (inches <= COLOR_STOPS[0].inches) return COLOR_STOPS[0].rgb;
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  if (inches >= last.inches) return last.rgb;
  for (let i = 1; i < COLOR_STOPS.length; i += 1) {
    const upper = COLOR_STOPS[i];
    const lower = COLOR_STOPS[i - 1];
    if (inches > upper.inches) continue;
    const t = (inches - lower.inches) / (upper.inches - lower.inches);
    return [
      Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * t),
      Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * t),
      Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * t),
    ];
  }
  return last.rgb;
}

function blur(source: Float64Array, width: number, height: number, sigma: number): Float64Array {
  const radius = Math.max(1, Math.ceil(sigma * 2.2));
  const kernel: number[] = [];
  let weight = 0;
  for (let i = -radius; i <= radius; i += 1) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(value);
    weight += value;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] /= weight;
  const temp = new Float64Array(width * height);
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(width - 1, Math.max(0, x + k));
        sum += source[y * width + xx] * kernel[k + radius];
      }
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + k));
        sum += temp[yy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

/** Cells of real hail sit above the ground skirt. Distance is in grid steps. */
function distanceToSkirt(values: Float64Array, width: number, height: number): Float64Array {
  const dist = new Float64Array(values.length);
  const far = 1e9;
  for (let i = 0; i < values.length; i += 1) dist[i] = values[i] > 0.05 ? far : 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (x > 0) dist[i] = Math.min(dist[i], dist[i - 1] + 1);
      if (y > 0) dist[i] = Math.min(dist[i], dist[i - width] + 1);
      if (x > 0 && y > 0) dist[i] = Math.min(dist[i], dist[i - width - 1] + 1.4);
      if (x + 1 < width && y > 0) dist[i] = Math.min(dist[i], dist[i - width + 1] + 1.4);
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (x + 1 < width) dist[i] = Math.min(dist[i], dist[i + 1] + 1);
      if (y + 1 < height) dist[i] = Math.min(dist[i], dist[i + width] + 1);
      if (x + 1 < width && y + 1 < height) dist[i] = Math.min(dist[i], dist[i + width + 1] + 1.4);
      if (x > 0 && y + 1 < height) dist[i] = Math.min(dist[i], dist[i + width - 1] + 1.4);
    }
  }
  return dist;
}

function downsample(values: Float64Array, width: number, height: number): { values: Float64Array; width: number; height: number; factor: number } {
  let grid = values;
  let w = width;
  let h = height;
  let factor = 1;
  while (w > 110 || h > 110) {
    const nw = Math.ceil(w / 2);
    const nh = Math.ceil(h / 2);
    const next = new Float64Array(nw * nh);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const index = Math.floor(y / 2) * nw + Math.floor(x / 2);
        next[index] = Math.max(next[index], grid[y * w + x]);
      }
    }
    grid = next;
    w = nw;
    h = nh;
    factor *= 2;
  }
  return { values: grid, width: w, height: h, factor };
}

/**
 * Smooth the radar grid into hill patches. Built once with the swath, so the
 * shape does not change when the map zooms.
 */
export function hailPatches(cells: MeshCell[], shape: MeshGridShape): HailPatch[] {
  const index = new Map<number, number>();
  for (const cell of cells) {
    if (cell.ix < 0 || cell.iy < 0 || cell.ix >= shape.nx || cell.iy >= shape.ny) continue;
    if (cell.inches < 0.45) continue;
    const key = cell.ix + cell.iy * shape.nx;
    const prev = index.get(key);
    if (prev == null || cell.inches > prev) index.set(key, cell.inches);
  }
  if (!index.size) return [];

  const mask = new Set<string>();
  for (const key of index.keys()) {
    const ix = key % shape.nx;
    const iy = Math.floor(key / shape.nx);
    for (let dy = -DILATE; dy <= DILATE; dy += 1) {
      for (let dx = -DILATE; dx <= DILATE; dx += 1) {
        const x = ix + dx;
        const y = iy + dy;
        if (x < 0 || y < 0 || x >= shape.nx || y >= shape.ny) continue;
        mask.add(`${x},${y}`);
      }
    }
  }

  const seen = new Set<string>();
  const patches: HailPatch[] = [];
  for (const start of mask) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    const members: Array<[number, number]> = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const [ix, iy] = queue[cursor].split(",").map(Number);
      members.push([ix, iy]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const next = `${ix + dx},${iy + dy}`;
        if (!mask.has(next) || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [ix, iy] of members) {
      minX = Math.min(minX, ix);
      maxX = Math.max(maxX, ix);
      minY = Math.min(minY, iy);
      maxY = Math.max(maxY, iy);
    }
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    if (width < 2 || height < 2) continue;
    const raw = new Float64Array(width * height);
    for (const [ix, iy] of members) {
      const inches = index.get(ix + iy * shape.nx) ?? 0;
      raw[(iy - minY) * width + (ix - minX)] = inches;
    }
    const reduced = downsample(raw, width, height);
    const smooth = blur(reduced.values, reduced.width, reduced.height, BLUR_SIGMA);
    const distance = distanceToSkirt(reduced.values, reduced.width, reduced.height);
    let maxDistance = 0;
    let rawPeak = 0;
    for (let i = 0; i < reduced.values.length; i += 1) rawPeak = Math.max(rawPeak, reduced.values[i]);
    for (let i = 0; i < distance.length; i += 1) maxDistance = Math.max(maxDistance, distance[i]);
    const shaped = new Float64Array(smooth.length);
    let shapedPeak = 0;
    for (let i = 0; i < smooth.length; i += 1) {
      const dome = maxDistance > 0 ? distance[i] / maxDistance : 0;
      shaped[i] = smooth[i] * dome ** 1.7;
      if (shaped[i] > shapedPeak) shapedPeak = shaped[i];
    }
    const gain = shapedPeak > 0 ? rawPeak / shapedPeak : 1;
    let peak = 0;
    const values: number[] = [];
    for (let i = 0; i < shaped.length; i += 1) {
      const inches = Math.round(Math.min(rawPeak, shaped[i] * gain) * 100) / 100;
      values.push(inches);
      if (inches > peak) peak = inches;
    }
    if (peak < 0.55) continue;
    patches.push({
      west: shape.west + minX * shape.step,
      south: shape.south + minY * shape.step,
      step: shape.step * reduced.factor,
      columns: reduced.width,
      rows: reduced.height,
      values,
    });
  }
  return patches;
}
