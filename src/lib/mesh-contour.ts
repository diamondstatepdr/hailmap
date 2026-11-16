import type { Feature, FeatureCollection, Polygon } from "geojson";
import { project, unproject } from "@/lib/geo";
import { MESH_LEGEND, MESH_STEP } from "@/lib/mesh-legend";
import { separateBandFills } from "@/lib/swath-bands";

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

function round5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

function ringCentroid(points: Array<[number, number]>): [number, number] {
  let lon = 0;
  let lat = 0;
  const count = Math.max(1, points.length - 1);
  for (let i = 0; i < points.length - 1; i += 1) {
    lon += points[i][0];
    lat += points[i][1];
  }
  return [lon / count, lat / count];
}

/** A soft dot. Same area as the patch, never a sharp corner. */
function circleRing(center: [number, number], radiusDeg: number, count = 24): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  const lonScale = Math.max(0.25, Math.cos((center[1] * Math.PI) / 180));
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    ring.push([
      round5(center[0] + (radiusDeg * Math.cos(angle)) / lonScale),
      round5(center[1] + radiusDeg * Math.sin(angle)),
    ]);
  }
  ring.push(ring[0]);
  return ring;
}

function blobRing(points: Array<[number, number]>): Array<[number, number]> {
  const center = ringCentroid(points);
  const area = Math.abs(ringArea(points));
  const radius = Math.max(Math.sqrt(area / Math.PI) * 1.08, 0.012);
  const ring = circleRing(center, radius);
  return ringArea(points) < 0 ? reverseClosed(ring) : ring;
}

function reverseClosed(points: Array<[number, number]>): Array<[number, number]> {
  const open = points.slice(0, -1).reverse();
  return [...open, open[0]];
}

/**
 * Move a closed ring by `km` (positive grows it). The shift follows the
 * corner bisector and is capped, so a sharp notch cannot throw a spike.
 */
function offsetRing(points: Array<[number, number]>, km: number): Array<[number, number]> {
  const open = points.slice(0, -1);
  if (open.length < 3 || km === 0) return points;
  const originLon = open.reduce((sum, point) => sum + point[0], 0) / open.length;
  const originLat = open.reduce((sum, point) => sum + point[1], 0) / open.length;
  const local = open.map((point) => project(point[0], point[1], originLon, originLat));
  let area = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    area += a.x * b.y - b.x * a.y;
  }
  const outward = area >= 0 ? -1 : 1;
  const result: Array<[number, number]> = [];
  for (let i = 0; i < local.length; i += 1) {
    const prev = local[(i - 1 + local.length) % local.length];
    const curr = local[i];
    const next = local[(i + 1) % local.length];
    const inDx = curr.x - prev.x;
    const inDy = curr.y - prev.y;
    const inLen = Math.hypot(inDx, inDy) || 1e-6;
    const outDx = next.x - curr.x;
    const outDy = next.y - curr.y;
    const outLen = Math.hypot(outDx, outDy) || 1e-6;
    const left1 = { x: -inDy / inLen, y: inDx / inLen };
    const left2 = { x: -outDy / outLen, y: outDx / outLen };
    let bx = left1.x + left2.x;
    let by = left1.y + left2.y;
    const length = Math.hypot(bx, by);
    if (length < 1e-6) {
      bx = left1.x;
      by = left1.y;
    } else {
      bx /= length;
      by /= length;
    }
    const align = Math.abs(left1.x * bx + left1.y * by);
    const miter = Math.min(Math.abs(km) * 1.35, Math.abs(km) / Math.max(0.45, align));
    const side = outward * Math.sign(km);
    const geo = unproject(curr.x + bx * miter * side, curr.y + by * miter * side, originLon, originLat);
    result.push([round5(geo.lon), round5(geo.lat)]);
  }
  result.push(result[0]);
  return result;
}

function cellCount(points: Array<[number, number]>, step: number): number {
  return Math.abs(ringArea(points)) / (step * step);
}

function isSmallSpiky(points: Array<[number, number]>, step: number): boolean {
  const cells = cellCount(points, step);
  if (cells < 24) return true;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const span = Math.max(east - west, north - south);
  const area = Math.abs(ringArea(points));
  // A long thin jag has little area for its reach. A real swath is wider.
  return cells < 70 && area < span * span * 0.2;
}

/** Buffer out, buffer back in, then round. The shape stays; the corners do not. */
function flowRing(points: Array<[number, number]>, step: number): Array<[number, number]> {
  const simplified = simplifyRing(points, Math.max(step * 0.42, 0.006));
  const km = step * 111 * 1.45;
  const grown = offsetRing(simplified, km);
  const shrunk = offsetRing(grown, -km);
  const area = Math.abs(ringArea(shrunk));
  const source = area > Math.abs(ringArea(simplified)) * 0.35 ? shrunk : simplified;
  let smooth = chaikinClosed(source, 5);
  if (smooth.length > 220) smooth = simplifyRing(smooth, Math.max(step * 0.1, 0.0025));
  return smooth.length >= 4 ? smooth : points;
}

/** Round stair-step grid corners into a smooth closed ring. */
function chaikinClosed(points: Array<[number, number]>, iterations: number): Array<[number, number]> {
  let ring = points;
  for (let pass = 0; pass < iterations; pass += 1) {
    const open = ring.slice(0, -1);
    if (open.length < 3) return points;
    const next: Array<[number, number]> = [];
    for (let i = 0; i < open.length; i += 1) {
      const start = open[i];
      const end = open[(i + 1) % open.length];
      next.push([start[0] * 0.75 + end[0] * 0.25, start[1] * 0.75 + end[1] * 0.25]);
      next.push([start[0] * 0.25 + end[0] * 0.75, start[1] * 0.25 + end[1] * 0.75]);
    }
    const rounded = next.map(
      (point) => [Math.round(point[0] * 1e5) / 1e5, Math.round(point[1] * 1e5) / 1e5] as [number, number],
    );
    ring = [...rounded, rounded[0]];
  }
  return ring;
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
  const cellArea = shape.step * shape.step;
  for (const band of MESH_LEGEND) {
    const rings = traceRings(cells, band.minIn, shape).filter((ring) => {
      const cellsInRing = Math.abs(ring.area) / cellArea;
      // Lone green specks clutter the map. A one-cell core of real hail stays.
      if (band.minIn <= MESH_LEGEND[0].minIn) return cellsInRing >= 3.5;
      return cellsInRing >= 0.6;
    });
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
          mapLabel: band.mapLabel,
          color: band.color,
          ink: band.ink,
          product: properties.product,
          validTime: properties.validTime,
          window: properties.label,
        },
      });
    });
  }
  // Nest the bands on the raw rings, then smooth. Doing it in this order keeps a
  // heavy core inside its parent, and the stored curve does not change with zoom.
  const nested = separateBandFills(features);
  const polygons = nested.filter((feature): feature is Feature<Polygon> => feature.geometry?.type === "Polygon");
  softenMeshPolygons(polygons, shape.step);
  const other = nested.filter((feature) => feature.geometry?.type !== "Polygon" && feature.geometry?.type !== "LineString");
  const edges: Feature[] = polygons
    .filter((feature) => feature.properties?.halo === true)
    .map((feature) => ({
      type: "Feature",
      properties: { halo: true, kind: "edge", color: feature.properties?.color ?? "#64748b" },
      geometry: { type: "LineString", coordinates: feature.geometry.coordinates[0] },
    }));
  return { type: "FeatureCollection", features: [...other, ...polygons, ...edges] };
}

function softenMeshPolygons(features: Feature[], step: number): void {
  const polygons = features.filter((feature): feature is Feature<Polygon> => feature.geometry?.type === "Polygon");
  for (const feature of polygons) {
    const ring = feature.geometry.coordinates[0];
    const holdsCore = feature.geometry.coordinates.length > 1;
    if (!holdsCore && isSmallSpiky(ring, step)) {
      feature.geometry = { type: "Polygon", coordinates: [blobRing(ring)] };
      continue;
    }
    // A small ring that still wraps a heavier core only gets its corners rounded.
    // A full buffer there can shrink the ring off the core and lose the nest.
    const gentle = cellCount(ring, step) < 40;
    const smooth = (points: Array<[number, number]>) =>
      gentle ? chaikinClosed(simplifyRing(points, Math.max(step * 0.3, 0.004)), 5) : flowRing(points, step);
    feature.geometry = {
      type: "Polygon",
      coordinates: [smooth(ring), ...feature.geometry.coordinates.slice(1).map((hole) => smooth(hole))],
    };
  }
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

/** Inches in the single grid cell under the point. Neighboring cells are left out so a core does not paint the lots beside it. */
export function sampleCell(index: Map<number, number>, shape: MeshGridShape, lat: number, lon: number): number | null {
  if (lat < shape.south || lat > shape.south + shape.ny * shape.step) return null;
  if (lon < shape.west || lon > shape.west + shape.nx * shape.step) return null;
  const ix = Math.min(shape.nx - 1, Math.max(0, Math.floor((lon - shape.west) / shape.step)));
  const iy = Math.min(shape.ny - 1, Math.max(0, Math.floor((lat - shape.south) / shape.step)));
  const value = index.get(ix + iy * shape.nx);
  return value == null ? null : Math.round(value * 100) / 100;
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
