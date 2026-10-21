import { describe, expect, it } from "vitest";
import { fieldPinPoint, resolveFieldAnchor } from "@/lib/field-status";

const storm = { lat: 33.45, lon: -112.07 };
const search = { lat: 32.75, lon: -97.33 };
const map = { lat: 33.5, lon: -112.1 };
const gps = { lat: 35.15, lon: -92.74 };

describe("field anchor order", () => {
  it("uses a selected storm, then a search, then the map", () => {
    expect(
      resolveFieldAnchor({ selection: storm, search, map, gps, gpsChosen: true }),
    ).toEqual({ ...storm, source: "selection" });
    expect(
      resolveFieldAnchor({ selection: null, search, map, gps, gpsChosen: true }),
    ).toEqual({ ...search, source: "search" });
    expect(
      resolveFieldAnchor({ selection: null, search: null, map, gps, gpsChosen: true }),
    ).toEqual({ ...map, source: "map" });
  });

  it("uses GPS only when the tech chose it and nothing else is known", () => {
    expect(
      resolveFieldAnchor({ selection: null, search: null, map: null, gps, gpsChosen: false }),
    ).toBeNull();
    expect(
      resolveFieldAnchor({ selection: null, search: null, map: null, gps, gpsChosen: true }),
    ).toEqual({ ...gps, source: "gps" });
    expect(resolveFieldAnchor({ selection: null, search: null, map: null })).toBeNull();
  });
});

describe("field house pin", () => {
  it("uses GPS only when location is on and the fix is within 1 km of the map", () => {
    const near = { lat: 33.502, lon: -112.1 };
    expect(fieldPinPoint({ gps: gps, locationOn: true, mapCenter: map })).toEqual(map);
    expect(fieldPinPoint({ gps: near, locationOn: true, mapCenter: map })).toEqual(near);
    expect(fieldPinPoint({ gps: near, locationOn: false, mapCenter: map })).toEqual(map);
    expect(
      fieldPinPoint({ gps: near, locationOn: true, mapCenter: map, tapped: { lat: 34, lon: -111 } }),
    ).toEqual({ lat: 34, lon: -111 });
    expect(fieldPinPoint({ gps: null, locationOn: false, mapCenter: null })).toBeNull();
  });
});
