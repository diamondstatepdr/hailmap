import { describe, expect, it } from "vitest";
import { beginAddressSelection } from "@/lib/address-lookup";
import { FIELD_LOOKUP_MS, fieldFallbackPoint, fieldScoreCopy, fieldStreetTitle } from "@/lib/field-status";
import { topScoreFactors, type DamageFactor } from "@/lib/probability";
import { isMarineReport, stormsForList } from "@/lib/storm-scope";
import { formatHailSources, formatMiles, milesToKm, nearestRadiusMi, SEARCH_RADIUS_MILES } from "@/lib/units";
import { parseMapLink, viewScopeLabel } from "@/lib/view-scope";
import type { HailReport } from "@/lib/types";

function report(overrides: Partial<HailReport> = {}): HailReport {
  return {
    id: "r1",
    source: "spc",
    confidence: "nws",
    hazard: "hail",
    lat: 32.75,
    lon: -97.33,
    sizeIn: 1.75,
    sizeRaw: null,
    windMph: null,
    efRating: null,
    occurredAt: "2026-04-25T18:00:00.000Z",
    location: "Fort Worth",
    county: "Tarrant",
    state: "TX",
    remark: null,
    damageTags: [],
    ...overrides,
  };
}

describe("Addresses selection", () => {
  it("starts a lookup and clears history so the empty card does not stay up", () => {
    const next = beginAddressSelection(
      { label: "3500 W 7th St, Fort Worth, TX", lat: 32.75, lon: -97.36 },
      5,
      168,
    );
    expect(next.loading).toBe(true);
    expect(next.history).toBeNull();
    expect(next.label).toContain("Fort Worth");
    expect(next.url).toContain("/api/place?");
    expect(next.url).toContain("lat=32.75");
    expect(next.url).toContain("lon=-97.36");
    expect(next.url).toContain(`radiusKm=${milesToKm(5)}`);
    expect(next.url).toContain("hours=168");
  });
});

describe("miles", () => {
  it("offers the mile chips and converts distances for the screen", () => {
    expect(SEARCH_RADIUS_MILES).toEqual([1, 3, 5, 10, 25]);
    expect(formatMiles(1.609344)).toBe("1 mi");
    expect(formatMiles(15)).toBe("9.3 mi");
    expect(formatMiles(40)).toBe("25 mi");
    expect(nearestRadiusMi(15)).toBe(10);
    expect(nearestRadiusMi(8)).toBe(5);
  });

  it("labels radar and spotter sizes with the radius", () => {
    expect(formatHailSources({ radarIn: 2.86, spotterIn: 2.75, radiusKm: 15 })).toBe(
      "2.86 in from radar · 2.75 in from a spotter within 9.3 mi",
    );
    expect(formatHailSources({ radarIn: null, spotterIn: null })).toBe("No hail size in this range");
  });
});

describe("Field fallbacks", () => {
  it("uses the searched address when GPS is missing, then the map center", () => {
    const searched = fieldFallbackPoint({
      gps: null,
      searched: { lat: 32.75, lon: -97.33 },
      view: { west: -100, south: 30, east: -90, north: 36 },
    });
    expect(searched).toMatchObject({ lat: 32.75, lon: -97.33, source: "search" });
    const center = fieldFallbackPoint({
      gps: null,
      searched: null,
      view: { west: -98, south: 32, east: -96, north: 34 },
    });
    expect(center).toMatchObject({ lat: 33, lon: -97, source: "map" });
    expect(fieldFallbackPoint({ gps: { lat: 1, lon: 2 }, searched: null, view: null })).toMatchObject({
      source: "gps",
    });
  });

  it("shows coordinates after the street lookup stalls and hides a zero score", () => {
    expect(
      fieldStreetTitle({ street: null, status: "loading", lat: 32.75, lon: -97.33, waitedMs: 0 }),
    ).toBe("Looking up the street…");
    expect(
      fieldStreetTitle({ street: null, status: "loading", lat: 32.75123, lon: -97.33001, waitedMs: FIELD_LOOKUP_MS }),
    ).toBe("32.75123, -97.33001");
    expect(fieldStreetTitle({ street: "3500 W 7th St", status: "ok", lat: 1, lon: 2, waitedMs: 9000 })).toBe(
      "3500 W 7th St",
    );
    expect(fieldScoreCopy({ score: null, windowLabel: "last 7 days" }).showScore).toBe(false);
    const empty = fieldScoreCopy({ score: 0, windowLabel: "last 7 days" });
    expect(empty.showScore).toBe(false);
    expect(empty.message).toMatch(/No hail here in the last 7 days/);
    expect(empty.message).toMatch(/90 days/);
    expect(fieldScoreCopy({ score: 40, windowLabel: "last 7 days" }).showScore).toBe(true);
  });
});

describe("audit helpers", () => {
  it("keeps the top three scoring factors", () => {
    const factors: DamageFactor[] = [
      { id: "a", label: "A", points: 4, detail: "a" },
      { id: "b", label: "B", points: 0, detail: "b" },
      { id: "c", label: "C", points: 12, detail: "c" },
      { id: "d", label: "D", points: 8, detail: "d" },
      { id: "e", label: "E", points: 1, detail: "e" },
    ];
    expect(topScoreFactors(factors).map((factor) => factor.id)).toEqual(["c", "d", "a"]);
  });

  it("drops marine zones from the storms list and keeps the map view", () => {
    const rows = [
      report(),
      report({ id: "marine", state: "PK", location: "Atlantic Waters" }),
      report({ id: "ak", state: "AK", lat: 58.3, lon: -134.4, location: "Juneau" }),
    ];
    const listed = stormsForList(rows, { west: -98, south: 32, east: -96, north: 34 });
    expect(listed.map((item) => item.id)).toEqual(["r1"]);
    expect(isMarineReport(report({ state: "GM", location: "Gulf" }))).toBe(true);
  });

  it("reads a map deep link and names the calendar scope", () => {
    expect(parseMapLink(new URLSearchParams("lat=32.75&lon=-97.33&z=11"))).toEqual({
      lat: 32.75,
      lon: -97.33,
      zoom: 11,
    });
    expect(viewScopeLabel(null, "")).toBe("Showing: all of US");
    expect(viewScopeLabel({ west: -97.5, south: 32.6, east: -97.2, north: 32.9 }, "tx")).toBe("Showing: TX");
  });
});
