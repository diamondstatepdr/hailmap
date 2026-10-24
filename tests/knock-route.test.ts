import { describe, expect, it } from "vitest";
import {
  APPLE_INTERMEDIATE,
  GOOGLE_WAYPOINTS,
  appleMapsHref,
  circlePolygon,
  googleMapsHref,
  compactBands,
  dropHoles,
  knockHailLabel,
  knockPinOffsets,
  meshHailAt,
  orderKnockStops,
  raiseKnockRoute,
  separateScreenPins,
  spreadPixelOffsets,
  streetsFromWays,
  type KnockStop,
} from "@/lib/knock-route";
import { pointInGeometry } from "@/lib/geo";

const area: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-97.4, 32.7],
      [-97.25, 32.7],
      [-97.25, 32.82],
      [-97.4, 32.82],
      [-97.4, 32.7],
    ],
  ],
};

function way(id: number, name: string, lat: number, lon: number, highway = "residential") {
  return {
    type: "way",
    id,
    tags: { name, highway },
    geometry: [
      { lat: lat - 0.002, lon: lon - 0.002 },
      { lat, lon },
      { lat: lat + 0.002, lon: lon + 0.002 },
    ],
  };
}

describe("door-knock route", () => {
  const focus = { lat: 32.75, lon: -97.33 };

  it("keeps the hardest sample of each residential street inside the swath", () => {
    const stops = streetsFromWays(
      [
        way(1, "West 7th Street", 32.75, -97.33),
        way(2, "West 7th Street", 32.751, -97.331),
        way(3, "Camp Bowie Boulevard", 32.76, -97.35, "primary"),
        way(4, "Harley Avenue", 32.77, -97.3),
        way(5, "Outside Lane", 33.2, -97.3),
        way(6, "", 32.74, -97.32),
      ],
      area,
      [{ minIn: 1.75, geometry: circlePolygon(32.75, -97.33, 0.4) }],
      focus,
      1,
    );
    expect(stops.map((stop) => stop.name)).toEqual(["West 7th Street", "Harley Avenue"]);
    expect(stops[0].hailIn).toBe(1.75);
    expect(stops[1].hailIn).toBe(1);
  });

  it("walks the nearest hard-hit street first, then the closest remaining block", () => {
    const stops: KnockStop[] = [
      { id: "a", name: "Far", lat: 32.8, lon: -97.2, hailIn: 2.5 },
      { id: "b", name: "Start", lat: 32.75, lon: -97.33, hailIn: 1 },
      { id: "c", name: "Next", lat: 32.755, lon: -97.325, hailIn: 1.5 },
    ];
    expect(orderKnockStops(stops, focus).map((stop) => stop.name)).toEqual(["Start", "Next", "Far"]);
  });

  it("respects Google and Apple waypoint limits", () => {
    const stops: KnockStop[] = Array.from({ length: 20 }, (_, index) => ({
      id: String(index),
      name: `Street ${index}`,
      lat: 32.7 + index * 0.01,
      lon: -97.4 + index * 0.01,
      hailIn: 1,
    }));
    const google = googleMapsHref(stops, "walk");
    const apple = appleMapsHref(stops, "drive");
    const waypoints = new URL(google.url).searchParams.get("waypoints")?.split("|") ?? [];
    expect(waypoints).toHaveLength(GOOGLE_WAYPOINTS);
    expect(google.count).toBe(GOOGLE_WAYPOINTS + 2);
    expect(new URL(google.url).searchParams.get("travelmode")).toBe("walking");
    expect(apple.url).toContain("dirflg=d");
    expect(apple.url.split("+to:")).toHaveLength(APPLE_INTERMEDIATE + 1);
    expect(apple.url.includes("%2B")).toBe(false);
    expect(apple.count).toBe(APPLE_INTERMEDIATE + 2);
  });

  it("lifts the route line above hail fills that were added later", () => {
    const order = ["mesh-fill", "knock-casing", "knock-line", "mesh-a-fill", "mesh-b-fill"];
    const map = {
      getLayer: (id: string) => (order.includes(id) ? { id } : undefined),
      moveLayer: (id: string) => {
        const index = order.indexOf(id);
        if (index >= 0) order.splice(index, 1);
        order.push(id);
      },
    };
    expect(raiseKnockRoute(map)).toBe(true);
    expect(order.slice(-2)).toEqual(["knock-casing", "knock-line"]);
    expect(raiseKnockRoute({ getLayer: () => undefined, moveLayer: () => undefined })).toBe(false);
  });

  it("names the route from the hail on the stops", () => {
    expect(knockHailLabel([{ hailIn: 1.5 }, { hailIn: 2 }])).toBe('1.5–2" hail');
    expect(knockHailLabel([{ hailIn: 1.5 }])).toBe('1.5" hail');
    expect(knockHailLabel([])).toBe("Door-knock route");
  });

  it("reads the hail band under the pin, including a harder core inside a tapped ring", () => {
    const holed: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-111.9, 33.3],
          [-111.7, 33.3],
          [-111.7, 33.5],
          [-111.9, 33.5],
          [-111.9, 33.3],
        ],
        [
          [-111.84, 33.38],
          [-111.8, 33.38],
          [-111.8, 33.42],
          [-111.84, 33.42],
          [-111.84, 33.38],
        ],
      ],
    };
    const core: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-111.84, 33.38],
          [-111.8, 33.38],
          [-111.8, 33.42],
          [-111.84, 33.42],
          [-111.84, 33.38],
        ],
      ],
    };
    expect(pointInGeometry(-111.82, 33.4, holed)).toBe(false);
    expect(pointInGeometry(-111.82, 33.4, dropHoles(holed))).toBe(true);
    expect(meshHailAt(-111.82, 33.4, [{ properties: { minIn: 1 }, geometry: holed }, { properties: { minIn: 2 }, geometry: core }], 1)).toBe(2);
    const inside = streetsFromWays(
      [way(9, "Core Street", 33.4, -111.82)],
      dropHoles(holed),
      [{ minIn: 2, geometry: core }],
      { lat: 33.4, lon: -111.82 },
      1,
    );
    expect(inside.map((stop) => stop.hailIn)).toEqual([2]);
  });

  it("keeps a higher hail band that is not the first polygon in the file", () => {
    const square = (minIn: number, pad: number): GeoJSON.Polygon => ({
      type: "Polygon",
      coordinates: [
        [
          [-111.9 - pad, 33.3 - pad],
          [-111.7 + pad, 33.3 - pad],
          [-111.7 + pad, 33.5 + pad],
          [-111.9 - pad, 33.5 + pad],
          [-111.9 - pad, 33.3 - pad],
        ],
      ],
    });
    const bands = compactBands(
      [
        { properties: { minIn: 0.75 }, geometry: square(0.75, 0.02) },
        { properties: { minIn: 0.75 }, geometry: square(0.75, 0.03) },
        { properties: { minIn: 1 }, geometry: square(1, 0.01) },
        { properties: { minIn: 1 }, geometry: square(1, 0) },
        { properties: { minIn: 1 }, geometry: square(1, 0.04) },
        { properties: { minIn: 1 }, geometry: square(1, 0.05) },
        { properties: { minIn: 2 }, geometry: square(2, 0) },
      ],
      { lat: 33.4, lon: -111.82 },
    );
    expect(bands.some((band) => band.minIn === 2)).toBe(true);
    expect(bands[0].minIn).toBe(2);
  });

  it("slides a stacked stop far enough that its number is readable", () => {
    const same = { lat: 33.415, lon: -111.83 };
    const offsets = knockPinOffsets([same, same, { lat: 33.43, lon: -111.8 }], 8);
    expect(offsets[0]).toEqual([0, 0]);
    expect(Math.hypot(offsets[1][0], offsets[1][1])).toBeGreaterThanOrEqual(30);
    expect(offsets[2]).toEqual([0, 0]);
    const pile = knockPinOffsets(Array.from({ length: 8 }, () => same), 8);
    for (let i = 0; i < pile.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const dx = pile[i][0] - pile[j][0];
        const dy = pile[i][1] - pile[j][1];
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(30);
      }
    }
    const close = spreadPixelOffsets(
      [
        { x: 100, y: 200 },
        { x: 108, y: 200 },
      ],
      48,
    );
    const apart = Math.hypot(108 + close[1][0] - 100, 200 + close[1][1] - 200);
    expect(apart).toBeGreaterThanOrEqual(48);
    const boxes = separateScreenPins(
      [
        { x: 40, y: 80, w: 32, h: 32 },
        { x: 48, y: 84, w: 32, h: 32 },
      ],
      6,
    );
    const moved = { x: 48 + boxes[1][0], y: 84 + boxes[1][1], w: 32, h: 32 };
    const gapX = Math.max(40, moved.x) - Math.min(72, moved.x + moved.w);
    const gapY = Math.max(80, moved.y) - Math.min(112, moved.y + moved.h);
    expect(gapX >= 6 || gapY >= 6).toBe(true);
  });

  it("uses a pin link when the route is a single street", () => {
    const stop: KnockStop = { id: "1", name: "West 7th Street", lat: 32.75, lon: -97.33, hailIn: 1.25 };
    expect(googleMapsHref([stop], "walk").url).toContain("query=32.75000,-97.33000");
    expect(appleMapsHref([stop], "walk").url).toContain("West%207th%20Street");
  });
});
