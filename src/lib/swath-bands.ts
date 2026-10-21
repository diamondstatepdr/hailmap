import type { Feature, Polygon, Position } from "geojson";

type Ring = Position[];

function ringArea(points: Ring): number {
  let area = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
  }
  return area / 2;
}

function centroid(ring: Ring): [number, number] {
  let lon = 0;
  let lat = 0;
  const count = Math.max(1, ring.length - 1);
  for (let i = 0; i < ring.length - 1; i += 1) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  return [lon / count, lat / count];
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
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

function bounds(ring: Ring): { west: number; south: number; east: number; north: number } {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of ring) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { west, south, east, north };
}

function containsBox(
  outer: { west: number; south: number; east: number; north: number },
  inner: { west: number; south: number; east: number; north: number },
): boolean {
  return inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;
}

function reverseRing(ring: Ring): Ring {
  return [...ring].reverse();
}

function outerRing(feature: Feature<Polygon>): Ring {
  return feature.geometry.coordinates[0];
}

/**
 * Nested size polygons paint on top of each other and the translucent fills
 * blend. Turn each band into the ring between it and the next size, keep a
 * halo only on the outside edge, and mark the core for a zoomed-in label.
 */
export function separateBandFills(features: Feature[]): Feature[] {
  const polygons: Feature<Polygon>[] = [];
  const rest: Feature[] = [];
  for (const feature of features) {
    const minIn = Number(feature.properties?.minIn);
    if (feature.geometry?.type === "Polygon" && Number.isFinite(minIn)) polygons.push(feature as Feature<Polygon>);
    else rest.push(feature);
  }
  const drop = new Set<Feature>();
  const levels = [...new Set(polygons.map((feature) => Number(feature.properties?.minIn)))].sort((a, b) => a - b);
  const at = (level: number) => polygons.filter((feature) => Number(feature.properties?.minIn) === level && !drop.has(feature));
  for (let index = 0; index < levels.length - 1; index += 1) {
    for (const outer of at(levels[index])) {
      const ring = outerRing(outer);
      const area = Math.abs(ringArea(ring));
      if (!(area > 0)) continue;
      const box = bounds(ring);
      for (const inner of at(levels[index + 1])) {
        const innerRing = outerRing(inner);
        if (!containsBox(box, bounds(innerRing))) continue;
        const probe = centroid(innerRing);
        if (!pointInRing(probe[0], probe[1], ring)) continue;
        if (Math.abs(ringArea(innerRing)) / area >= 0.9) drop.add(outer);
      }
    }
  }
  const kept = polygons.filter((feature) => !drop.has(feature));
  const keptLevels = [...new Set(kept.map((feature) => Number(feature.properties?.minIn)))].sort((a, b) => a - b);
  const edges: Feature[] = [];
  for (const feature of kept) {
    const level = Number(feature.properties?.minIn);
    const index = keptLevels.indexOf(level);
    const ring = outerRing(feature);
    const box = bounds(ring);
    const holes = feature.geometry.coordinates.slice(1);
    const next = keptLevels[index + 1];
    if (next != null) {
      for (const inner of kept) {
        if (Number(inner.properties?.minIn) !== next) continue;
        const innerRing = outerRing(inner);
        if (!containsBox(box, bounds(innerRing))) continue;
        const probe = centroid(innerRing);
        if (!pointInRing(probe[0], probe[1], ring)) continue;
        holes.push(reverseRing(innerRing));
      }
    }
    feature.geometry = { type: "Polygon", coordinates: [ring, ...holes] };
    const probe = centroid(ring);
    let insideLower = false;
    let insideHigher = false;
    for (const other of kept) {
      if (other === feature) continue;
      const otherLevel = Number(other.properties?.minIn);
      const otherRing = outerRing(other);
      if (otherLevel < level && containsBox(bounds(otherRing), box) && pointInRing(probe[0], probe[1], otherRing)) insideLower = true;
      if (otherLevel > level) {
        const core = centroid(otherRing);
        if (containsBox(box, bounds(otherRing)) && pointInRing(core[0], core[1], ring)) insideHigher = true;
      }
    }
    feature.properties = { ...(feature.properties ?? {}), halo: !insideLower, showLabel: !insideHigher };
    if (!insideLower) {
      edges.push({
        type: "Feature",
        properties: { halo: true, kind: "edge", color: feature.properties?.color ?? "#64748b" },
        geometry: { type: "LineString", coordinates: ring },
      });
    }
  }
  return [...rest, ...kept, ...edges];
}
