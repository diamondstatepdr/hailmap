import { MESH_LEGEND } from "@/lib/mesh-legend";
import type { MeshCell, MeshGridShape } from "@/lib/mesh-contour";
import { SWATH_HEIGHT_ZOOM } from "@/lib/swath-extrusion";

/**
 * Classic radar thermal ramp. Deep blue is the smallest hail, then cyan,
 * green, yellow, orange, red, and magenta into white-hot.
 */
export const RADAR_STOPS = [
  { inches: 0.4, color: "#10266f" },
  { inches: 0.75, color: "#1c6adf" },
  { inches: 1, color: "#14c4b0" },
  { inches: 1.5, color: "#d6de2a" },
  { inches: 2, color: "#f07814" },
  { inches: 2.3, color: "#e0232c" },
  { inches: 2.5, color: "#e030c8" },
  { inches: 3.3, color: "#fff6f8" },
] as const;

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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span <= 0) return x >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - edge0) / span));
  return t * t * (3 - 2 * t);
}

/**
 * A few meters of extra lift as the field crosses each color threshold.
 * The rise is eased over a slice of hail size, so the terrace stays a soft
 * shelf instead of a wall.
 */
function softShelves(inches: number): number {
  let lift = 0;
  for (let i = 1; i < RADAR_STOPS.length; i += 1) {
    const stop = RADAR_STOPS[i].inches;
    lift += smoothstep(stop - 0.02, stop + 0.18, inches) * 420;
  }
  return lift;
}

/**
 * Meters of relief at the reference zoom. Low at every size: a gentle slope,
 * a soft shelf at each radar band, and a compressed top so large hail does
 * not become a tower or a flat cap.
 */
export function hillMeters(inches: number): number {
  const rise = Math.max(0, inches - 0.22);
  const curved = rise <= 3.1 ? rise ** 1.12 : 3.1 ** 1.12 + (rise - 3.1) ** 0.62 * 0.45;
  return Math.round(curved * 3900 + softShelves(inches));
}

/**
 * 0 at the fringe and 1 at a single crest. Distance-to-edge kills the cliff
 * at the polygon boundary, and a gentle falloff from the centroid keeps a
 * long swath from holding a flat ridge. `inradiusM` is the ground distance
 * from that crest to the fringe, so the slope stays a fraction of the footprint.
 */
export function reliefDome(patch: HailPatch): { dome: Float64Array; inradiusM: number } {
  const width = patch.columns;
  const height = patch.rows;
  const lat = patch.south + ((height - 1) * patch.step) / 2;
  const cellX = Math.max(patch.step, 1e-6) * 111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const cellY = Math.max(patch.step, 1e-6) * 111320;
  const diag = Math.hypot(cellX, cellY);
  const far = 1e12;
  const dist = new Float64Array(width * height);
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = (patch.values[y * width + x] ?? 0) > 0.45;
      dist[y * width + x] = inside ? far : 0;
      if (!inside) continue;
      count += 1;
      sumX += x;
      sumY += y;
    }
  }
  if (!count) return { dome: dist, inradiusM: cellY };
  const relax = (y0: number, y1: number, dy: number, x0: number, x1: number, dx: number) => {
    for (let y = y0; y !== y1; y += dy) {
      for (let x = x0; x !== x1; x += dx) {
        const index = y * width + x;
        if (dist[index] === 0) continue;
        let best = dist[index] ?? far;
        const px = x - dx;
        const py = y - dy;
        if (px >= 0 && px < width) best = Math.min(best, (dist[y * width + px] ?? far) + cellX);
        if (py >= 0 && py < height) best = Math.min(best, (dist[py * width + x] ?? far) + cellY);
        if (px >= 0 && px < width && py >= 0 && py < height) best = Math.min(best, (dist[py * width + px] ?? far) + diag);
        const qx = x + dx;
        if (qx >= 0 && qx < width && py >= 0 && py < height) best = Math.min(best, (dist[py * width + qx] ?? far) + diag);
        dist[index] = best;
      }
    }
  };
  relax(0, height, 1, 0, width, 1);
  relax(height - 1, -1, -1, width - 1, -1, -1);
  let inradiusM = 0;
  for (let i = 0; i < dist.length; i += 1) {
    if ((dist[i] ?? 0) >= far / 2) dist[i] = 0;
    if ((dist[i] ?? 0) > inradiusM) inradiusM = dist[i] ?? 0;
  }
  const cx = sumX / count;
  const cy = sumY / count;
  let reach = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((patch.values[y * width + x] ?? 0) <= 0.45) continue;
      reach = Math.max(reach, Math.hypot((x - cx) * cellX, (y - cy) * cellY));
    }
  }
  const dome = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const edge = inradiusM > 0 ? (dist[y * width + x] ?? 0) / inradiusM : 0;
      const along = reach > 0 ? Math.hypot((x - cx) * cellX, (y - cy) * cellY) / reach : 0;
      // A light falloff from the middle keeps a long swath from a flat ridge,
      // without erasing the saddle between two report centers.
      dome[y * width + x] = edge * (1 - 0.18 * along * along);
    }
  }
  const soft = blur(dome, width, height, 1.15);
  let peak = 0;
  for (let i = 0; i < soft.length; i += 1) if ((soft[i] ?? 0) > peak) peak = soft[i] ?? 0;
  if (peak > 0) for (let i = 0; i < soft.length; i += 1) soft[i] = Math.max(0, (soft[i] ?? 0) / peak);
  return { dome: soft, inradiusM: Math.max(cellY, inradiusM) };
}

/**
 * Meters of a rolling hill. Two and a half inches rises about three quarters of
 * the inradius: tall enough to read at a phone pitch, still shorter than the
 * footprint. The dome holds the fringe on the ground.
 */
export function drapedMeters(inches: number, inradiusM: number, dome: number): number {
  if (inches <= 0.45) return 0;
  const reference = hillMeters(2.5) || 1;
  const size = Math.sqrt(Math.min(1, hillMeters(inches) / reference));
  const crown = Math.max(0, Math.min(1, dome));
  // The shelves add up to the same crest. Each one is a short rounded rise.
  const shelves = 0.9 + 0.1 * radarBandLift(inches);
  return inradiusM * 0.72 * size * shelves * crown;
}

export function hillZoomScale(zoom: number): number {
  const matched = 2 ** (SWATH_HEIGHT_ZOOM - zoom);
  if (zoom >= SWATH_HEIGHT_ZOOM) return 2 ** (0.72 * (SWATH_HEIGHT_ZOOM - zoom));
  return matched * 2 ** (0.65 * (zoom - SWATH_HEIGHT_ZOOM));
}

const COLOR_STOPS = RADAR_STOPS.map((band) => ({
  inches: band.inches,
  rgb: [parseInt(band.color.slice(1, 3), 16), parseInt(band.color.slice(3, 5), 16), parseInt(band.color.slice(5, 7), 16)] as [number, number, number],
}));

function hexChannel(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Hail-size key in the same thermal order as the 3D surface. */
export function radarLegendBands(): Array<{ minIn: number; label: string; mapLabel: string; color: string }> {
  return MESH_LEGEND.map((band) => ({
    minIn: band.minIn,
    label: band.label,
    mapLabel: band.mapLabel,
    color: hexChannel(sampleColor(band.minIn <= 0.75 ? 0.7 : band.minIn)),
  }));
}

/** Continuous bar for the map legend. */
export function radarRampCss(): string {
  const first = RADAR_STOPS[0].inches;
  const last = RADAR_STOPS[RADAR_STOPS.length - 1].inches;
  const span = last - first || 1;
  const stops = RADAR_STOPS.map((stop) => `${stop.color} ${(((stop.inches - first) / span) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

/** GLSL body that samples {@link RADAR_STOPS}. `inches` is the fragment value. */
export function radarRampGlsl(): string {
  const vec = (rgb: [number, number, number]) => `vec3(${rgb.map((channel) => (channel / 255).toFixed(4)).join(", ")})`;
  const lines: string[] = [];
  COLOR_STOPS.forEach((stop, index) => {
    if (index === 0) {
      lines.push(`if (inches <= ${stop.inches.toFixed(2)}) return ${vec(stop.rgb)};`);
      return;
    }
    const prev = COLOR_STOPS[index - 1];
    const span = (stop.inches - prev.inches).toFixed(4);
    lines.push(
      `if (inches <= ${stop.inches.toFixed(2)}) { float t = clamp((inches - ${prev.inches.toFixed(2)}) / ${span}, 0.0, 1.0); return mix(${vec(prev.rgb)}, ${vec(stop.rgb)}, t); }`,
    );
  });
  lines.push(`return ${vec(COLOR_STOPS[COLOR_STOPS.length - 1].rgb)};`);
  return lines.join("\n  ");
}

/** Hail sizes that draw a radar contour. */
export const RADAR_BANDS = [0.75, 1, 1.5, 2, 2.5] as const;

/**
 * Band color with a soft hold. Most of a size interval stays near that
 * threshold's color, then eases into the next one. `px` is fwidth(inches).
 */
export function radarBandGlsl(): string {
  const vec = (rgb: [number, number, number]) => `vec3(${rgb.map((channel) => (channel / 255).toFixed(4)).join(", ")})`;
  const byInches = new Map(COLOR_STOPS.map((stop) => [stop.inches, stop.rgb]));
  const lines: string[] = [];
  for (let i = 0; i < RADAR_BANDS.length - 1; i += 1) {
    const lo = RADAR_BANDS[i];
    const hi = RADAR_BANDS[i + 1];
    const loRgb = byInches.get(lo);
    const hiRgb = byInches.get(hi);
    if (!loRgb || !hiRgb) continue;
    const span = (hi - lo).toFixed(4);
    lines.push(
      `if (inches <= ${hi.toFixed(2)}) { float span = ${span}; float edge = clamp(px * 2.4 / span, 0.1, 0.42); float u = clamp((inches - ${lo.toFixed(2)}) / span, 0.0, 1.0); float t = smoothstep(1.0 - edge * 2.2, 1.0, u); return mix(${vec(loRgb)}, ${vec(hiRgb)}, t); }`,
    );
  }
  return lines.join("\n  ");
}

/** Thin anti-aliased lip (high side) and groove (low side) at each radar threshold. */
export function radarRimGlsl(): string {
  return RADAR_BANDS.map((inches) => {
    const stop = inches.toFixed(2);
    return `s = (inches - ${stop}) / px; line = exp(-0.5 * s * s / 1.7); lip = max(lip, line * smoothstep(-0.25, 1.2, s)); groove = max(groove, line * smoothstep(0.25, -1.2, s));`;
  }).join("\n  ");
}

/** 0 below the first contour, 1 once every band has been crossed. Eased, not a step. */
export function radarBandLift(inches: number): number {
  let lift = 0;
  for (const stop of RADAR_BANDS) lift += smoothstep(stop - 0.04, stop + 0.16, inches);
  return lift / RADAR_BANDS.length;
}

/**
 * RGBA 0–1. Thermal color by hail size. The fringe fades out so the basemap
 * stays readable. The core stays semi-translucent.
 */
export function hillColor(inches: number): [number, number, number, number] {
  const rgb = sampleColor(inches);
  // Nothing under the outer swath. A short fade, then a capped core.
  if (inches <= 0.5) return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 0];
  const t = Math.min(1, (inches - 0.5) / 0.7);
  const fade = t * t * (3 - 2 * t);
  const alpha = 0.64 * fade;
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
        const xx = x + k;
        if (xx < 0 || xx >= width) continue;
        sum += source[y * width + xx] * kernel[k + radius];
      }
      temp[y * width + x] = sum;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = y + k;
        if (yy < 0 || yy >= height) continue;
        sum += temp[yy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

function padZeros(values: Float64Array, width: number, height: number, pad: number): { values: Float64Array; width: number; height: number } {
  const nextWidth = width + pad * 2;
  const nextHeight = height + pad * 2;
  const next = new Float64Array(nextWidth * nextHeight);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) next[(y + pad) * nextWidth + (x + pad)] = values[y * width + x];
  }
  return { values: next, width: nextWidth, height: nextHeight };
}

function downsample(values: Float64Array, width: number, height: number): { values: Float64Array; width: number; height: number; factor: number } {
  let grid = values;
  let w = width;
  let h = height;
  let factor = 1;
  while (w > 280 || h > 280) {
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
    const patch = finishPatch(raw, width, height, shape.west + minX * shape.step, shape.south + minY * shape.step, shape.step);
    if (patch) patches.push(patch);
  }
  return patches;
}

/** Spread each hail size across a small disk so a hot core is a blob, not one cell. */
function spreadPeaks(source: Float64Array, width: number, height: number, radius: number): Float64Array {
  const out = new Float64Array(source.length);
  const radiusSq = radius * radius;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radiusSq) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const value = source[yy * width + xx];
          if (value > max) max = value;
        }
      }
      out[y * width + x] = max;
    }
  }
  return out;
}

function finishPatch(
  raw: Float64Array,
  width: number,
  height: number,
  west: number,
  south: number,
  step: number,
): HailPatch | null {
  const reduced = downsample(raw, width, height);
  const skirt = 8;
  const padded = padZeros(reduced.values, reduced.width, reduced.height, skirt);
  const spread = spreadPeaks(padded.values, padded.width, padded.height, 1);
  const soft = blur(spread, padded.width, padded.height, 1.55);
  let rawPeak = 0;
  for (let i = 0; i < padded.values.length; i += 1) rawPeak = Math.max(rawPeak, padded.values[i]);
  const shaped = new Float64Array(soft.length);
  const sampleSoft = (sx: number, sy: number) => {
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const tx = sx - x0;
    const ty = sy - y0;
    const at = (xx: number, yy: number) => {
      if (xx < 0 || yy < 0 || xx >= padded.width || yy >= padded.height) return 0;
      return soft[yy * padded.width + xx];
    };
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
  for (let y = 0; y < padded.height; y += 1) {
    for (let x = 0; x < padded.width; x += 1) {
      const i = y * padded.width + x;
      const inside = spread[i];
      let inches = inside >= 0.5 ? Math.max(soft[i], inside * 0.98) : 0;
      if (inches < 0.5) {
        const ox = fringeNoise(x * 0.37 + west * 24, y * 0.37 + south * 24) * 1.25;
        const oy = fringeNoise(x * 0.37 + 11 + west * 24, y * 0.37 + south * 24) * 1.25;
        inches = sampleSoft(x + ox, y + oy);
      }
      if (inches < 0.5) continue;
      shaped[i] = Math.min(rawPeak, inches);
    }
  }
  let peak = 0;
  const values: number[] = [];
  for (let i = 0; i < shaped.length; i += 1) {
    const inches = Math.round(Math.min(rawPeak, Math.max(0, shaped[i])) * 100) / 100;
    values.push(inches);
    if (inches > peak) peak = inches;
  }
  if (peak < 0.55) return null;
  const coarse = step * reduced.factor;
  return {
    west: west - skirt * coarse,
    south: south - skirt * coarse,
    step: coarse,
    columns: padded.width,
    rows: padded.height,
    values,
  };
}

const TEXTURE_INCHES = 6;

/**
 * A fine raster of the patch for the GPU. Linear filtering of this image is
 * what draws the outline, so the edge is a curve instead of the data cells.
 * Long side stays at or under 960 texels.
 */
export function radarTexture(patch: HailPatch): { width: number; height: number; rgba: Uint8Array } {
  const long = Math.max(patch.columns, patch.rows);
  const factor = Math.max(2, Math.min(5, Math.floor(960 / Math.max(2, long))));
  const width = (patch.columns - 1) * factor + 1;
  const height = (patch.rows - 1) * factor + 1;
  const dense = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const gy = y / factor;
    const y0 = Math.min(patch.rows - 1, Math.floor(gy));
    const y1 = Math.min(patch.rows - 1, y0 + 1);
    const ty = gy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < width; x += 1) {
      const gx = x / factor;
      const x0 = Math.min(patch.columns - 1, Math.floor(gx));
      const x1 = Math.min(patch.columns - 1, x0 + 1);
      const tx = gx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const a = patch.values[y0 * patch.columns + x0] ?? 0;
      const b = patch.values[y0 * patch.columns + x1] ?? 0;
      const c = patch.values[y1 * patch.columns + x0] ?? 0;
      const d = patch.values[y1 * patch.columns + x1] ?? 0;
      dense[y * width + x] = a * (1 - sx) * (1 - sy) + b * sx * (1 - sy) + c * (1 - sx) * sy + d * sx * sy;
    }
  }
  const smoothed = blur(dense, width, height, factor * 0.8);
  let peak = 0;
  let peakX = 0;
  let peakY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = smoothed[y * width + x] ?? 0;
      if (value > peak) {
        peak = value;
        peakX = x;
        peakY = y;
      }
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const hotSigma = 3.2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inches = Math.max(0, smoothed[y * width + x] ?? 0);
      const index = (y * width + x) * 4;
      rgba[index] = Math.min(255, Math.round((inches / TEXTURE_INCHES) * 255));
      const dx = x - peakX;
      const dy = y - peakY;
      const hot = peak >= 2.05 && inches >= peak * 0.96 ? Math.exp(-(dx * dx + dy * dy) / (2 * hotSigma * hotSigma)) : 0;
      rgba[index + 1] = Math.min(255, Math.round(hot * 255));
      rgba[index + 2] = 0;
      rgba[index + 3] = 255;
    }
  }
  return { width, height, rgba };
}

/** Deterministic fringe wobble, about -1 to 1, so a round buffer is not a perfect circle. */
function fringeNoise(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

function insideRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]?.[0] ?? 0;
    const yi = ring[i]?.[1] ?? 0;
    const xj = ring[j]?.[0] ?? 0;
    const yj = ring[j]?.[1] ?? 0;
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function polygonInches(properties: GeoJSON.GeoJsonProperties): number {
  const props = properties ?? {};
  for (const key of ["maxSizeIn", "maxIn", "minIn"] as const) {
    const value = Number(props[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0.85;
}

type Stamp = {
  west: number;
  south: number;
  east: number;
  north: number;
  inches: number;
  outer: number[][];
  holes: number[][][];
};

function boundsOf(ring: number[][]): { west: number; south: number; east: number; north: number } | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of ring) {
    const lon = point[0];
    const lat = point[1];
    if (lon == null || lat == null) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!Number.isFinite(west) || east - west < 1e-6 || north - south < 1e-6) return null;
  return { west, south, east, north };
}

function stampsFromFeatures(features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: GeoJSON.GeoJsonProperties }>): Stamp[] {
  const stamps: Stamp[] = [];
  const pushPolygon = (coordinates: number[][][], properties: GeoJSON.GeoJsonProperties) => {
    const outer = coordinates[0];
    if (!outer || outer.length < 4) return;
    const box = boundsOf(outer);
    if (!box) return;
    stamps.push({
      ...box,
      inches: polygonInches(properties),
      outer,
      holes: coordinates.slice(1),
    });
  };
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon") pushPolygon(geometry.coordinates, feature.properties ?? null);
    else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) pushPolygon(polygon, feature.properties ?? null);
    }
  }
  return stamps;
}

function boxesTouch(a: Stamp, b: Stamp, gap: number): boolean {
  return a.west - gap <= b.east && b.west - gap <= a.east && a.south - gap <= b.north && b.south - gap <= a.north;
}

/** Overlapping report swaths, including nested size bands, share one grid. */
function clusterStamps(stamps: Stamp[], gap: number): Stamp[][] {
  const parent = stamps.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const union = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let i = 0; i < stamps.length; i += 1) {
    for (let j = i + 1; j < stamps.length; j += 1) {
      if (boxesTouch(stamps[i], stamps[j], gap)) union(i, j);
    }
  }
  const groups = new Map<number, Stamp[]>();
  for (let i = 0; i < stamps.length; i += 1) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(stamps[i]);
    else groups.set(root, [stamps[i]]);
  }
  return [...groups.values()];
}

function rasterizeGroup(parts: Stamp[]): HailPatch | null {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const part of parts) {
    west = Math.min(west, part.west);
    east = Math.max(east, part.east);
    south = Math.min(south, part.south);
    north = Math.max(north, part.north);
  }
  const span = Math.max(east - west, north - south);
  if (!(span > 0)) return null;
  const step = Math.max(0.018, span / 96);
  const columns = Math.max(2, Math.ceil((east - west) / step) + 1);
  const rows = Math.max(2, Math.ceil((north - south) / step) + 1);
  const raw = new Float64Array(columns * rows);
  for (const part of parts) {
    const x0 = Math.max(0, Math.floor((part.west - west) / step));
    const x1 = Math.min(columns - 1, Math.ceil((part.east - west) / step));
    const y0 = Math.max(0, Math.floor((part.south - south) / step));
    const y1 = Math.min(rows - 1, Math.ceil((part.north - south) / step));
    for (let y = y0; y <= y1; y += 1) {
      const lat = south + y * step;
      for (let x = x0; x <= x1; x += 1) {
        const lon = west + x * step;
        if (!insideRing(lon, lat, part.outer)) continue;
        if (part.holes.some((hole) => insideRing(lon, lat, hole))) continue;
        const index = y * columns + x;
        if (part.inches > raw[index]) raw[index] = part.inches;
      }
    }
  }
  return finishPatch(raw, columns, rows, west, south, step);
}

/**
 * One heat field per cluster of overlapping report polygons. Nested size bands
 * composite by the larger hail size, then the same kernel blur used for radar.
 */
export function patchesFromPolygons(features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: GeoJSON.GeoJsonProperties }>): HailPatch[] {
  const stamps = stampsFromFeatures(features);
  if (!stamps.length) return [];
  const patches: HailPatch[] = [];
  for (const group of clusterStamps(stamps, 0.12)) {
    const patch = rasterizeGroup(group);
    if (patch) patches.push(patch);
  }
  return patches;
}
