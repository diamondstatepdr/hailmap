import { describe, expect, it } from "vitest";
import { dealersFromElements, geometryBounds, overpassQuery } from "@/lib/dealers";
import { mergeWarnings, warningsFromIem } from "@/lib/warnings-nearby";

describe("dealership finder", () => {
  const geometry: GeoJSON.Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [-97.6, 35.4],
        [-97.3, 35.4],
        [-97.3, 35.6],
        [-97.6, 35.6],
        [-97.6, 35.4],
      ],
    ],
  };

  it("keeps dealerships inside the swath and drops malls and duplicates", () => {
    const dealers = dealersFromElements(
      [
        {
          type: "node",
          id: 1,
          lat: 35.5,
          lon: -97.5,
          tags: { shop: "car", name: "North Honda", "addr:housenumber": "10", "addr:street": "Main St", "addr:city": "Oklahoma City", "addr:state": "OK" },
        },
        {
          type: "node",
          id: 2,
          lat: 35.5001,
          lon: -97.5001,
          tags: { shop: "car", name: "North Honda" },
        },
        {
          type: "way",
          id: 3,
          center: { lat: 35.48, lon: -97.42 },
          tags: { amenity: "parking", name: "Auto Mall Lot" },
        },
        {
          type: "node",
          id: 4,
          lat: 35.52,
          lon: -97.4,
          tags: { amenity: "parking", name: "Mall Garage" },
        },
        {
          type: "node",
          id: 5,
          lat: 36.2,
          lon: -97.5,
          tags: { shop: "car", name: "Outside Motors" },
        },
        {
          type: "way",
          id: 6,
          center: { lat: 35.51, lon: -97.45 },
          tags: { highway: "primary", name: "Ford Avenue" },
        },
      ],
      geometry,
      { lat: 35.5, lon: -97.5 },
    );
    expect(dealers.map((dealer) => dealer.name)).toEqual(["North Honda", "Auto Mall Lot"]);
    expect(dealers[0]).toMatchObject({ kind: "dealership", address: "10 Main St, Oklahoma City, OK" });
    expect(dealers[1].kind).toBe("lot");
    expect(dealers[0].distanceKm).toBeLessThan(dealers[1].distanceKm);
  });

  it("builds an Overpass bbox and refuses to measure an empty ring", () => {
    const bounds = geometryBounds(geometry);
    expect(bounds).toEqual({ west: -97.6, south: 35.4, east: -97.3, north: 35.6 });
    expect(overpassQuery(bounds!)).toContain('nwr["shop"="car"](35.4,-97.6,35.6,-97.3)');
  });
});

describe("nearby warnings", () => {
  it("keeps severe thunderstorm and tornado events inside the window", () => {
    const warnings = warningsFromIem([
      {
        name: "Severe Thunderstorm Warning",
        phenomena: "SV",
        significance: "W",
        issue: "2026-10-18T22:00:00Z",
        expire: "2026-10-18T23:00:00Z",
        wfo: "OUN",
        ugc: "OKC027",
        eventid: 10,
      },
      {
        name: "Flood Advisory",
        phenomena: "FA",
        significance: "Y",
        issue: "2026-10-18T22:00:00Z",
        expire: "2026-10-19T02:00:00Z",
        wfo: "OUN",
        eventid: 11,
      },
      {
        name: "Tornado Watch",
        phenomena: "TO",
        significance: "A",
        issue: "2026-10-01T00:00:00Z",
        expire: "2026-10-01T06:00:00Z",
        wfo: "OUN",
        eventid: 12,
      },
    ]);
    const merged = mergeWarnings([warnings], Date.parse("2026-10-18T00:00:00Z"), Date.parse("2026-10-19T00:00:00Z"));
    expect(merged.map((warning) => warning.event)).toEqual(["Severe Thunderstorm Warning"]);
    expect(merged[0]).toMatchObject({ kind: "warning", office: "OUN", area: "OKC027" });
  });
});
