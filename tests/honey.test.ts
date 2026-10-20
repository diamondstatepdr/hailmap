import { describe, expect, it } from "vitest";
import { countsFromAcs, countsFromDataCensus, countyNameFromAcs, tractsFromTiger, tractsWithHomes } from "@/lib/honey-census";
import { honeyOverpassQuery, targetsFromElements } from "@/lib/honey-osm";
import { hailAreas, warmTileCount } from "@/lib/honey-warm";
import {
  CLUSTER_RADIUS_KM,
  confidenceFor,
  densityFactor,
  hailWeight,
  recencyFactor,
  ringAreaM2,
  scoreHoney,
  scorePlaces,
  showHoneyRanking,
  sizesAgree,
  toSpots,
  vehiclesFromArea,
  type HailEvidence,
  type HoneyPlace,
} from "@/lib/honey";

describe("money hole score", () => {
  it("estimates vehicles from lot area at about 30 square meters each", () => {
    expect(vehiclesFromArea(3000)).toBe(100);
    expect(vehiclesFromArea(3000, 2)).toBe(200);
    expect(vehiclesFromArea(0)).toBe(0);
  });

  it("measures a ring in square meters", () => {
    const side = 0.001;
    const area = ringAreaM2([
      [-97.3, 32.75],
      [-97.3 + side, 32.75],
      [-97.3 + side, 32.75 + side],
      [-97.3, 32.75 + side],
      [-97.3, 32.75],
    ]);
    expect(area).toBeGreaterThan(8000);
    expect(area).toBeLessThan(16000);
  });

  it("raises confidence when a spotter report agrees with radar", () => {
    expect(sizesAgree(1.75, 2)).toBe(true);
    expect(sizesAgree(1, 3.5)).toBe(false);
    const agreed = confidenceFor({
      meshIn: 1.75,
      report: { lat: 0, lon: 0, sizeIn: 2, occurredAt: null, confidence: "spotter", location: null },
    });
    const radar = confidenceFor({ meshIn: 1.75, report: null });
    const spotter = confidenceFor({
      meshIn: null,
      report: { lat: 0, lon: 0, sizeIn: 1.75, occurredAt: null, confidence: "spotter", location: "Fort Worth" },
    });
    expect(agreed).toMatchObject({ factor: 1, agreement: true, source: "agreed", hailIn: 2 });
    expect(radar).toMatchObject({ factor: 0.65, agreement: false, source: "mesh" });
    expect(spotter.factor).toBe(0.85);
    expect(agreed.factor).toBeGreaterThan(radar.factor);
    expect(agreed.factor).toBeGreaterThan(spotter.factor);
  });

  it("decays recency through a storm day and on a live window", () => {
    const latest = Date.parse("2024-05-10T02:00:00.000Z");
    const fresh = recencyFactor("2024-05-10T01:40:00.000Z", latest, false);
    const morning = recencyFactor("2024-05-09T18:00:00.000Z", latest, false);
    expect(fresh).toBeGreaterThan(morning);
    expect(fresh).toBeGreaterThan(0.9);
    const now = Date.parse("2026-04-25T23:00:00.000Z");
    const justNow = recencyFactor("2026-04-25T22:40:00.000Z", null, true, now);
    const stale = recencyFactor("2026-04-25T08:00:00.000Z", null, true, now);
    expect(justNow).toBeGreaterThan(stale);
  });

  it("ranks a severe dealer row ahead of a mild airport lot", () => {
    const dealer = scoreHoney({ mode: "pdr", hailIn: 2.5, count: 500, recency: 1, confidence: 1 });
    const airport = scoreHoney({ mode: "pdr", hailIn: 1, count: 4000, recency: 0.84, confidence: 0.65 });
    expect(dealer.raw).toBeGreaterThan(airport.raw);
    expect(dealer.score).toBeGreaterThan(airport.score);
    expect(dealer.score).toBeGreaterThanOrEqual(65);
    expect(airport.level === "Low" || airport.level === "Moderate").toBe(true);
  });

  it("ranks confirmed hail above radar-only, and fresher hail above older hail", () => {
    const agreed = scoreHoney({ mode: "pdr", hailIn: 1.75, count: 220, recency: 1, confidence: 1 });
    const radar = scoreHoney({ mode: "pdr", hailIn: 1.75, count: 220, recency: 1, confidence: 0.65 });
    const older = scoreHoney({ mode: "pdr", hailIn: 1.75, count: 220, recency: 0.66, confidence: 1 });
    expect(agreed.score).toBeGreaterThan(radar.score);
    expect(agreed.raw).toBeGreaterThan(older.raw);
  });

  it("lets bigger hail beat a larger neighborhood when the hail is only pea-sized", () => {
    const prime = scoreHoney({ mode: "roof", hailIn: 2.25, count: 700, recency: 0.95, confidence: 1 });
    const pea = scoreHoney({ mode: "roof", hailIn: 0.75, count: 4000, recency: 0.84, confidence: 0.65 });
    expect(prime.raw).toBeGreaterThan(pea.raw);
    expect(densityFactor(2000, 800)).toBeGreaterThan(densityFactor(700, 800));
    expect(hailWeight(2.25)).toBeGreaterThan(hailWeight(1));
  });

  it("clusters a dealer row and lists the severe pocket first", () => {
    const places: HoneyPlace[] = [
      place("dealer-a", "dealership", "Park Place Lexus", 32.91, -97.32, 140, 0),
      place("dealer-b", "dealership", "Park Place Toyota", 32.912, -97.318, 160, 0),
      place("dealer-c", "dealership", "Park Place Honda", 32.908, -97.322, 120, 0),
      place("airport", "parking", "DFW Airport", 32.9, -97.04, 3500, 0, "area"),
    ];
    const reports: HailEvidence[] = [
      { lat: 32.91, lon: -97.32, sizeIn: 2.5, occurredAt: "2024-05-10T01:30:00.000Z", confidence: "spotter", location: "Southlake" },
      { lat: 32.9, lon: -97.04, sizeIn: 1, occurredAt: "2024-05-09T22:00:00.000Z", confidence: "spotter", location: "DFW" },
    ];
    const mesh = (lat: number, lon: number) => (Math.abs(lon + 97.32) < 0.05 ? 2.25 : Math.abs(lon + 97.04) < 0.05 ? 1 : null);
    const scored = scorePlaces(places, reports, mesh, false, Date.parse("2024-05-10T12:00:00.000Z"));
    const spots = toSpots(scored, "pdr", { lat: 32.75, lon: -97.33 });
    expect(spots[0].name).toMatch(/Park Place/);
    expect(spots[0].hailIn).toBeGreaterThanOrEqual(2.25);
    expect(spots[0].agreement).toBe(true);
    expect(spots[0].vehicles).toBeGreaterThanOrEqual(140 + 160 + 120);
    expect(spots[0].distanceKm).toBeLessThan(spots.find((spot) => /Airport/.test(spot.name))?.distanceKm ?? 99);
    expect(CLUSTER_RADIUS_KM).toBeGreaterThan(0.5);
    const airport = spots.find((spot) => /Airport/.test(spot.name));
    expect(airport).toBeTruthy();
    expect(spots[0].raw).toBeGreaterThan(airport?.raw ?? 99);
  });
});

describe("money hole targets", () => {
  const bounds = { west: -97.4, south: 32.7, east: -97.2, north: 32.9 };

  it("keeps dealers, large lots, apartments, malls, and fleet yards", () => {
    const side = 0.004;
    const lot = ring(-97.3, 32.8, side);
    const tiny = ring(-97.31, 32.81, 0.0004);
    const parsed = targetsFromElements(
      [
        { type: "node", id: 1, lat: 32.75, lon: -97.33, tags: { shop: "car", name: "Frank Kent Honda", "addr:city": "Fort Worth" } },
        { type: "way", id: 2, geometry: lot, tags: { amenity: "parking", name: "Hulen Mall Garage" } },
        { type: "way", id: 3, geometry: tiny, tags: { amenity: "parking", name: "Tiny Lot", parking: "surface" } },
        { type: "way", id: 4, geometry: lot, tags: { amenity: "parking", parking: "street_side", name: "Street" } },
        { type: "way", id: 5, geometry: ring(-97.28, 32.78, 0.002), tags: { building: "apartments", name: "The Village", "building:flats": "240" } },
        { type: "node", id: 6, lat: 32.76, lon: -97.35, tags: { shop: "mall", name: "Ridgmar Mall" } },
        { type: "node", id: 7, lat: 32.77, lon: -97.34, tags: { amenity: "car_rental", name: "Enterprise Fort Worth" } },
        { type: "node", id: 8, lat: 32.74, lon: -97.36, tags: { place: "suburb", name: "Ridglea" } },
        { type: "node", id: 9, lat: 36, lon: -97.3, tags: { shop: "car", name: "Outside Motors" } },
      ],
      bounds,
    );
    const names = parsed.targets.map((target) => target.name);
    expect(names).toContain("Frank Kent Honda");
    expect(names).toContain("Hulen Mall Garage");
    expect(names).toContain("The Village");
    expect(names).toContain("Ridgmar Mall");
    expect(names).toContain("Enterprise Fort Worth");
    expect(names).not.toContain("Tiny Lot");
    expect(names).not.toContain("Street");
    expect(names).not.toContain("Outside Motors");
    expect(parsed.targets.find((target) => target.name === "The Village")).toMatchObject({ kind: "apartments", homes: 240 });
    expect(parsed.targets.find((target) => target.name === "Frank Kent Honda")?.kind).toBe("dealership");
    expect(parsed.targets.find((target) => target.name === "Enterprise Fort Worth")?.kind).toBe("fleet");
    expect(parsed.places.map((place) => place.name)).toEqual(["Ridglea"]);
    expect(honeyOverpassQuery(bounds)).toContain('nwr["shop"="car"]');
    expect(honeyOverpassQuery(bounds)).toContain('way["amenity"="parking"]');
  });
});

describe("census homes", () => {
  it("joins tract centroids to housing units", () => {
    const seeds = tractsFromTiger({
      features: [
        {
          attributes: { GEOID: "48439113605", BASENAME: "1136.05", STATE: "48", COUNTY: "439" },
          geometry: { rings: [[[-97.36, 32.71], [-97.34, 32.71], [-97.34, 32.73], [-97.36, 32.73], [-97.36, 32.71]]] },
        },
      ],
    });
    const counts = countsFromAcs([
      ["NAME", "B25001_001E", "B11001_001E", "state", "county", "tract"],
      ["Census Tract 1136.05, Tarrant County, Texas", "1820", "1704", "48", "439", "113605"],
    ]);
    expect(countyNameFromAcs([
      ["NAME"],
      ["Census Tract 1136.05, Tarrant County, Texas"],
    ])).toBe("Tarrant County");
    const fromTable = countsFromDataCensus({
      response: {
        data: [
          ["GEO_ID", "B25001_001E", "NAME"],
          ["1400000US48439113605", "1820", "Census Tract 1136.05; Tarrant County; Texas"],
        ],
      },
    });
    expect(fromTable.countyName).toBe("Tarrant County");
    expect(fromTable.counts["48439113605"]?.housingUnits).toBe(1820);
    const tracts = tractsWithHomes(seeds, counts, { "48439": "Tarrant County" });
    expect(tracts).toEqual([
      { geoid: "48439113605", basename: "1136.05", county: "Tarrant County", lat: 32.72, lon: -97.35, homes: 1820 },
    ]);
  });
});

describe("money hole loading", () => {
  it("hides a ranking until the response is complete", () => {
    expect(showHoneyRanking({ partial: true, loading: true })).toBe(false);
    expect(showHoneyRanking({ partial: true, loading: false })).toBe(false);
    expect(showHoneyRanking({ partial: false, loading: true })).toBe(false);
    expect(showHoneyRanking({ partial: false, loading: false })).toBe(true);
  });

  it("groups recent hail into city-sized warm boxes", () => {
    const areas = hailAreas([
      { lat: 32.75, lon: -97.33 },
      { lat: 32.78, lon: -97.31 },
      { lat: 33.2, lon: -96.8 },
    ]);
    expect(areas).toHaveLength(2);
    const fortWorth = areas.find((area) => area.south < 32.75 && area.north > 32.78);
    expect(fortWorth).toBeTruthy();
    expect(fortWorth!.east - fortWorth!.west).toBeLessThan(1);
    expect(fortWorth!.north - fortWorth!.south).toBeLessThan(1);
    expect(warmTileCount(areas)).toBeGreaterThanOrEqual(2);
    expect(warmTileCount(areas)).toBeLessThanOrEqual(16);
  });
});

function place(
  id: string,
  kind: HoneyPlace["kind"],
  name: string,
  lat: number,
  lon: number,
  vehicles: number,
  homes: number,
  vehicleBasis: HoneyPlace["vehicleBasis"] = "default",
): HoneyPlace {
  return { id, kind, name, city: null, neighborhood: null, lat, lon, vehicles, homes, vehicleBasis };
}

function ring(lon: number, lat: number, side: number): Array<{ lat: number; lon: number }> {
  return [
    { lon, lat },
    { lon: lon + side, lat },
    { lon: lon + side, lat: lat + side },
    { lon, lat: lat + side },
    { lon, lat },
  ];
}
