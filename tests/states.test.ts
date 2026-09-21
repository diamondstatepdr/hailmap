import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface OverlayFeature {
  type: "Feature";
  properties: { abbr: string; name: string; kind: "boundary" | "label"; area: number };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] }
    | { type: "Point"; coordinates: [number, number] };
}

function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function insideGeometry(x: number, y: number, geometry: OverlayFeature["geometry"]): boolean {
  if (geometry.type === "Point") return false;
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => {
    if (!pointInRing(x, y, polygon[0])) return false;
    return polygon.slice(1).every((hole) => !pointInRing(x, y, hole));
  });
}

describe("US state overlay", () => {
  const overlay = JSON.parse(readFileSync(new URL("../src/data/us-states.json", import.meta.url), "utf8")) as {
    type: string;
    features: OverlayFeature[];
  };

  it("has a boundary and an interior name for every state and D.C.", () => {
    expect(overlay.type).toBe("FeatureCollection");
    const boundaries = overlay.features.filter((feature) => feature.properties.kind === "boundary");
    const labels = overlay.features.filter((feature) => feature.properties.kind === "label");
    expect(boundaries).toHaveLength(51);
    expect(labels).toHaveLength(51);
    const abbrs = boundaries.map((feature) => feature.properties.abbr).sort();
    expect(abbrs).toContain("UT");
    expect(abbrs).toContain("DC");
    expect(new Set(abbrs).size).toBe(51);

    for (const label of labels) {
      expect(label.geometry.type).toBe("Point");
      expect(label.properties.name.length).toBeGreaterThan(1);
      const boundary = boundaries.find((feature) => feature.properties.abbr === label.properties.abbr);
      expect(boundary).toBeTruthy();
      const [lon, lat] = (label.geometry as { type: "Point"; coordinates: [number, number] }).coordinates;
      expect(insideGeometry(lon, lat, boundary!.geometry)).toBe(true);
    }
  });
});
