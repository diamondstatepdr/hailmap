import { describe, expect, it } from "vitest";
import type { DealerPin } from "@/lib/area-selection";
import { dealerDirections, hailAtLot, rankDealersByHail, telHref } from "@/lib/dealer-hit";

const heavy: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-97.36, 32.76],
      [-97.28, 32.76],
      [-97.28, 32.8],
      [-97.36, 32.8],
      [-97.36, 32.76],
    ],
  ],
};

function dealer(partial: Partial<DealerPin> & Pick<DealerPin, "id" | "name" | "lat" | "lon">): DealerPin {
  return {
    address: "Fort Worth",
    distanceKm: 1,
    kind: "dealership",
    phone: null,
    ...partial,
  };
}

describe("dealership hit list", () => {
  it("ranks lots by hail size and keeps distance as the tie break", () => {
    const ranked = rankDealersByHail(
      [
        dealer({ id: "near", name: "Near Motors", lat: 32.75, lon: -97.33, distanceKm: 0.4, phone: "(817) 555-0100" }),
        dealer({ id: "far", name: "Far Honda", lat: 32.78, lon: -97.31, distanceKm: 3, kind: "lot" }),
        dealer({ id: "same", name: "Same Hail", lat: 32.751, lon: -97.332, distanceKm: 0.2 }),
      ],
      [{ minIn: 2.5, geometry: heavy }],
      1,
    );
    expect(ranked.map((dealer) => dealer.name)).toEqual(["Far Honda", "Same Hail", "Near Motors"]);
    expect(ranked[0].hailIn).toBe(2.5);
    expect(ranked[1].hailIn).toBe(1);
    expect(ranked[1].distanceKm).toBeLessThan(ranked[2].distanceKm);
  });

  it("uses the mesh inches inside the heaviest band covering the lot", () => {
    const outer: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-111.9, 33.3],
          [-111.7, 33.3],
          [-111.7, 33.5],
          [-111.9, 33.5],
          [-111.9, 33.3],
        ],
      ],
    };
    const core: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [-111.8, 33.4],
          [-111.76, 33.4],
          [-111.76, 33.44],
          [-111.8, 33.44],
          [-111.8, 33.4],
        ],
      ],
    };
    const bands = [
      { minIn: 1, geometry: outer },
      { minIn: 2.5, geometry: core },
    ];
    const ranked = rankDealersByHail(
      [
        dealer({ id: "edge", name: "Edge Motors", lat: 33.35, lon: -111.85, distanceKm: 1, meshIn: 1.22 }),
        dealer({ id: "core", name: "Core Honda", lat: 33.42, lon: -111.78, distanceKm: 4, meshIn: 2.53 }),
        dealer({ id: "floor", name: "Floor Cars", lat: 33.36, lon: -111.84, distanceKm: 0.5 }),
      ],
      bands,
      1,
    );
    expect(ranked.map((item) => item.name)).toEqual(["Core Honda", "Edge Motors", "Floor Cars"]);
    expect(ranked[0].hailIn).toBe(2.53);
    expect(ranked[1].hailIn).toBe(1.22);
    expect(ranked[2].hailIn).toBe(1);
    expect(hailAtLot(33.35, -111.85, bands, 1, 2.53)).toBe(2.53);
  });

  it("builds a tap-to-call link and driving directions", () => {
    expect(telHref("(817) 555-0100")).toBe("tel:8175550100");
    expect(telHref("not a phone")).toBeNull();
    expect(hailAtLot(32.75, -97.33, [], 1.75)).toBe(1.75);
    const directions = dealerDirections(32.75, -97.33);
    expect(directions.google).toContain("destination=32.75000%2C-97.33000");
    expect(directions.google).toContain("travelmode=driving");
    expect(directions.apple).toBe("https://maps.apple.com/?daddr=32.75000,-97.33000&dirflg=d");
  });
});
