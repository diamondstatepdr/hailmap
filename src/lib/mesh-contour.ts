import type { Feature, FeatureCollection, Polygon } from "geojson";
import { MESH_LEGEND, MESH_STEP } from "@/lib/mesh-legend";

export interface MeshCell {
  ix: number;
  iy: number;
  inches: number;
}

export interface MeshGridShape {
  west: number;
  south: number;
  step: number;
  nx: number;
  ny: number;
}

interface Ring {
  points: Array<[number, number]>;
  area: number;
}

function corner(shape: MeshGridShape, ix: number, iy: number): [number, number] {
  const lon = Math.round((shape.west + ix * shape.step) * 1e5) / 1e5;
  const lat = Math.round((shape.south + iy * shape.step) * 1e5) / 1e5;
  return [lon, lat];
}

function ringArea(points: Array<[number, number]>): number {
  let area = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }
  return area / 2;
}

function pointInRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distToSegment(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function simplifyOpen(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length < 3) return points;
  let maxDistance = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i += 1) {
    const distance = distToSegment(points[i], points[0], points[last]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points[last]];
  const left = simplifyOpen(points.slice(0, index + 1), tolerance);
  const right = simplifyOpen(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

function simplifyRing(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 5) return points;
  const open = points.slice(0, -1);
  const simplified = simplifyOpen(open, tolerance);
  if (simplified.length < 3) return points;
  return [...simplified, simplified[0]];
}

function traceRings(cells: MeshCell[], minIn: number, shape: MeshGridShape): Ring[] {
  const inside = new Set<string>();
  for (const cell of cells) {
    if (cell.inches + 1e-9 >= minIn) inside.add(`${cell.ix},${cell.iy}`);
  }
  if (!inside.size) return [];

  const directed = new Set<string>();
  const toggle = (x1: number, y1: number, x2: number, y2: number) => {
    const reverse = `${x2},${y2},${x1},${y1}`;
    if (directed.has(reverse)) directed.delete(reverse);
    else directed.add(`${x1},${y1},${x2},${y2}`);
  };
  for (const key of inside) {
    const [ix, iy] = key.split(",").map(Number);
    toggle(ix, iy, ix + 1, iy);
    toggle(ix + 1, iy, ix + 1, iy + 1);
    toggle(ix + 1, iy + 1, ix, iy + 1);
    toggle(ix, iy + 1, ix, iy);
  }

  const next = new Map<string, string>();
  for (const edge of directed) {
    const [x1, y1, x2, y2] = edge.split(",").map(Number);
    next.set(`${x1},${y1}`, `${x2},${y2}`);
  }

  const seen = new Set<string>();
  const rings: Ring[] = [];
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const chain: string[] = [];
    let cursor = start;
    let closed = false;
    for (let guard = 0; guard < 200000; guard += 1) {
      if (chain.length > 0 && cursor === start) {
        closed = true;
        break;
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      chain.push(cursor);
      const step = next.get(cursor);
      if (!step) break;
      cursor = step;
    }
    if (!closed || chain.length < 4) continue;
    const points = chain.map((vertex) => {
      const [ix, iy] = vertex.split(",").map(Number);
      return corner(shape, ix, iy);
    });
    points.push(points[0]);
    rings.push({ points, area: ringArea(points) });
  }
  return rings;
}

function maxInside(cells: MeshCell[], outer: Array<[number, number]>, holes: Array<Array<[number, number]>>, shape: MeshGridShape, minIn: number): number {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of outer) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  let max = minIn;
  for (const cell of cells) {
    if (cell.inches < minIn) continue;
    const lon = shape.west + (cell.ix + 0.5) * shape.step;
    const lat = shape.south + (cell.iy + 0.5) * shape.step;
    if (lon < west || lon > east || lat < south || lat > north) continue;
    if (!pointInRing(lon, lat, outer)) continue;
    if (holes.some((hole) => pointInRing(lon, lat, hole))) continue;
    if (cell.inches > max) max = cell.inches;
  }
  return Math.round(max * 100) / 100;
}

/** Turn binned MESH maxima into nested hail-size polygons. */
export function cellsToSwaths(
  cells: MeshCell[],
  shape: MeshGridShape,
  properties: { product: string; validTime: string | null; label: string },
): FeatureCollection {
  const features: Feature[] = [];
  const tolerance = Math.max(shape.step * 0.6, 0.012);
  for (const band of MESH_LEGEND) {
    const rings = traceRings(cells, band.minIn, shape).map((ring) => ({
      ...ring,
      points: simplifyRing(ring.points, tolerance),
    }));
    const outers = rings.filter((ring) => ring.area > 0 && ring.points.length >= 4);
    const holes = rings.filter((ring) => ring.area < 0 && ring.points.length >= 4);
    outers.forEach((outer, index) => {
      const owned = holes.filter((hole) => pointInRing(hole.points[0][0], hole.points[0][1], outer.points));
      const maxIn = maxInside(
        cells,
        outer.points,
        owned.map((hole) => hole.points),
        shape,
        band.minIn,
      );
      const coordinates = [outer.points, ...owned.map((hole) => hole.points)];
      const id = `mesh-${band.minIn}-${features.length}-${index}`;
      features.push({
        type: "Feature",
        id,
        geometry: { type: "Polygon", coordinates } as Polygon,
        properties: {
          id,
          kind: "mesh",
          minIn: band.minIn,
          maxIn,
          label: band.label,
          color: band.color,
          product: properties.product,
          validTime: properties.validTime,
          window: properties.label,
        },
      });
    });
  }
  return { type: "FeatureCollection", features };
}

export function sampleGrid(cells: MeshCell[], shape: MeshGridShape, lat: number, lon: number): number | null {
  if (lat < shape.south || lat > shape.south + shape.ny * shape.step) return null;
  if (lon < shape.west || lon > shape.west + shape.nx * shape.step) return null;
  const ix = Math.min(shape.nx - 1, Math.max(0, Math.floor((lon - shape.west) / shape.step)));
  const iy = Math.min(shape.ny - 1, Math.max(0, Math.floor((lat - shape.south) / shape.step)));
  let max: number | null = null;
  for (const cell of cells) {
    if (Math.abs(cell.ix - ix) > 1 || Math.abs(cell.iy - iy) > 1) continue;
    max = max == null ? cell.inches : Math.max(max, cell.inches);
  }
  return max == null ? null : Math.round(max * 100) / 100;
}

/** Fast neighborhood sample when cells are indexed. */
export function sampleIndexed(
  index: Map<number, number>,
  shape: MeshGridShape,
  lat: number,
  lon: number,
): number | null {
  if (lat < shape.south || lat > shape.south + shape.ny * shape.step) return null;
  if (lon < shape.west || lon > shape.west + shape.nx * shape.step) return null;
  const ix = Math.min(shape.nx - 1, Math.max(0, Math.floor((lon - shape.west) / shape.step)));
  const iy = Math.min(shape.ny - 1, Math.max(0, Math.floor((lat - shape.south) / shape.step)));
  let max: number | null = null;
  for (let y = iy - 1; y <= iy + 1; y += 1) {
    if (y < 0 || y >= shape.ny) continue;
    for (let x = ix - 1; x <= ix + 1; x += 1) {
      if (x < 0 || x >= shape.nx) continue;
      const value = index.get(x + y * shape.nx);
      if (value == null) continue;
      max = max == null ? value : Math.max(max, value);
    }
  }
  return max == null ? null : Math.round(max * 100) / 100;
}

export function indexCells(cells: MeshCell[], shape: MeshGridShape): Map<number, number> {
  const index = new Map<number, number>();
  for (const cell of cells) {
    if (cell.ix < 0 || cell.iy < 0 || cell.ix >= shape.nx || cell.iy >= shape.ny) continue;
    const key = cell.ix + cell.iy * shape.nx;
    const prev = index.get(key);
    if (prev == null || cell.inches > prev) index.set(key, cell.inches);
  }
  return index;
}

export function swathBounds(collection: FeatureCollection): { west: number; south: number; east: number; north: number } | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (lon: number, lat: number) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };
  for (const feature of collection.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates) for (const [lon, lat] of ring) visit(lon, lat);
    } else if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates) for (const ring of polygon) for (const [lon, lat] of ring) visit(lon, lat);
    }
  }
  if (!Number.isFinite(west)) return null;
  return { west, south, east, north };
}

export const DEFAULT_MESH_SHAPE: MeshGridShape = {
  west: -130,
  south: 20,
  step: MESH_STEP,
  nx: Math.round(70 / MESH_STEP),
  ny: Math.round(35 / MESH_STEP),
};
