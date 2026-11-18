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
 * Height scale for the terrain mesh. At a regional zoom the hill stays a
 * similar modest size. Zooming further out shrinks it again, so a country
 * view cannot grow spikes.
 */
export function hillZoomScale(zoom: number): number {
  const matched = 2 ** (SWATH_HEIGHT_ZOOM - zoom);
  if (zoom >= SWATH_HEIGHT_ZOOM) return matched;
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

/** Soft screen-space hints at the main size thresholds. Wide and faint, not a stroke. */
export function radarRimGlsl(): string {
  return [1, 1.5, 2, 2.5]
    .map((inches) => `rim = max(rim, 1.0 - smoothstep(w * 0.9, w * 4.8, abs(inches - ${inches.toFixed(2)})));`)
    .join("\n  ");
}

/**
 * RGBA 0–1. Thermal color by hail size. The fringe fades out so the basemap
 * stays readable. The core stays semi-translucent.
 */
export function hillColor(inches: number): [number, number, number, number] {
  const rgb = sampleColor(inches);
  if (inches <= 0.12) return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 0];
  const t = Math.min(1, (inches - 0.12) / 1.05);
  const fade = t * t * (3 - 2 * t);
  const alpha = 0.12 + 0.58 * fade;
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
  const span = Math.min(reduced.width, reduced.height);
  // Wide enough that a straight polygon side bows into a curve.
  const sigma = Math.min(12, Math.max(5.2, span * 0.42));
  const skirt = Math.min(26, Math.max(14, Math.ceil(sigma * 2.5)));
  const padded = padZeros(reduced.values, reduced.width, reduced.height, skirt);
  const spread = spreadPeaks(padded.values, padded.width, padded.height, 2);
  const cores = blur(spread, padded.width, padded.height, 0.65);
  const presence = new Float64Array(padded.values.length);
  for (let i = 0; i < padded.values.length; i += 1) presence[i] = padded.values[i] > 0.05 ? 1 : 0;
  const mask = blur(presence, padded.width, padded.height, sigma);
  let maskPeak = 0;
  let rawPeak = 0;
  for (let i = 0; i < padded.values.length; i += 1) rawPeak = Math.max(rawPeak, padded.values[i]);
  for (let i = 0; i < mask.length; i += 1) maskPeak = Math.max(maskPeak, mask[i]);
  const shaped = new Float64Array(mask.length);
  const amp = sigma * 0.9;
  const sampleMask = (sx: number, sy: number) => {
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const tx = sx - x0;
    const ty = sy - y0;
    const at = (xx: number, yy: number) => {
      if (xx < 0 || yy < 0 || xx >= padded.width || yy >= padded.height) return 0;
      return mask[yy * padded.width + xx];
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
      const ox = fringeNoise(x * 0.17 + west * 20, y * 0.17 + south * 20) * amp;
      const oy = fringeNoise(x * 0.17 + 19 + west * 20, y * 0.17 + south * 20) * amp;
      const t = maskPeak > 0 ? sampleMask(x + ox, y + oy) / maskPeak : 0;
      const edge = smoothstep(0.04, 0.46, t);
      if (edge <= 0) continue;
      const core = cores[i];
      const coreShare = rawPeak > 0 ? core / rawPeak : 0;
      const fringe = rawPeak * 0.38 * smoothstep(0.04, 0.55, t) * (1 - smoothstep(0.12, 0.5, coreShare));
      shaped[i] = Math.max(core * smoothstep(0.08, 0.5, t), fringe) * (0.9 + 0.1 * edge);
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
