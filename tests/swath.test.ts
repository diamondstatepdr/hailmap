import { describe, expect, it } from "vitest";
import { bufferPoints, clusterBySpaceTime, convexHull, reportsToSwaths, type SwathPoint } from "@/lib/swath";

const T0 = "2026-09-21T18:00:00.000Z";

function at(lat: number, hours: number, id: string): SwathPoint {
  return {
    id,
    lat,
    lon: -97.4,
    occurredAt: new Date(Date.parse(T0) + hours * 3600 * 1000).toISOString(),
  };
}

describe("clusterBySpaceTime", () => {
  it("clusters a chain inside 45 km and 3 hours", () => {
    const clusters = clusterBySpaceTime([
      at(35, 0, "a"),
      at(35.3, 0.5, "b"),
      at(35.6, 1, "c"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it("splits points that are farther than 45 km", () => {
    const clusters = clusterBySpaceTime([at(35, 0, "a"), at(35.5, 0, "b")]);
    expect(clusters).toHaveLength(2);
  });

  it("splits points more than 3 hours apart", () => {
    const clusters = clusterBySpaceTime([at(35, 0, "a"), at(35.1, 4, "b")]);
    expect(clusters).toHaveLength(2);
  });

  it("keeps reports two hours apart in one cluster", () => {
    const clusters = clusterBySpaceTime([at(35, 0, "a"), at(35.1, 2, "b")]);
    expect(clusters).toHaveLength(1);
  });
});

describe("convexHull and buffer", () => {
  it("drops an interior point", () => {
    const hull = convexHull([
      { lon: 0, lat: 0 },
      { lon: 1, lat: 0 },
      { lon: 0, lat: 1 },
      { lon: 0.2, lat: 0.2 },
    ]);
    expect(hull).toHaveLength(3);
  });

  it("expands a buffered ring past the original point", () => {
    const ring = bufferPoints([{ lon: -97, lat: 35 }], 8);
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(Math.max(...ring.map((point) => point.lat))).toBeGreaterThan(35.04);
  });
});

describe("reportsToSwaths", () => {
  it("returns a closed polygon for a report cluster", () => {
    const collection = reportsToSwaths([at(35, 0, "a"), at(35.2, 0.2, "b"), at(35.05, 0.4, "c")]);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(1);
    const geometry = collection.features[0].geometry;
    expect(geometry.type).toBe("Polygon");
    if (geometry.type !== "Polygon") return;
    const ring = geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(collection.features[0].properties?.count).toBe(3);
  });

  it("returns no features for an empty list", () => {
    expect(reportsToSwaths([]).features).toEqual([]);
  });
});
