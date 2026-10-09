import { describe, expect, it } from "vitest";
import { parseCensusLocations, parseNominatim, streetFromNominatim } from "@/lib/forward-geocode";

describe("forward geocoding parsers", () => {
  it("reads a Census oneline match", () => {
    const hits = parseCensusLocations({
      result: {
        addressMatches: [
          {
            matchedAddress: "4600 Silver Hill Rd, WASHINGTON, DC, 20233",
            coordinates: { x: -76.927, y: 38.846 },
            addressComponents: { city: "WASHINGTON", state: "DC", zip: "20233" },
          },
        ],
      },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].lon).toBeCloseTo(-76.927);
    expect(hits[0].lat).toBeCloseTo(38.846);
    expect(hits[0].state).toBe("DC");
    expect(hits[0].source).toBe("census");
  });

  it("reads a Nominatim result and a reverse street", () => {
    const hits = parseNominatim([
      {
        lat: "35.222",
        lon: "-97.439",
        display_name: "Norman, Cleveland County, Oklahoma, United States",
        address: { city: "Norman", state: "Oklahoma", postcode: "73069" },
      },
    ]);
    expect(hits[0].city).toBe("Norman");
    expect(hits[0].source).toBe("nominatim");
    expect(streetFromNominatim({ address: { road: "Main Street", city: "Norman" } })).toBe("Main Street, Norman");
    expect(streetFromNominatim({})).toBeNull();
  });

  it("ignores matches without coordinates", () => {
    expect(parseCensusLocations({ result: { addressMatches: [{ matchedAddress: "Nope" }] } })).toEqual([]);
    expect(parseNominatim({ not: "an array" })).toEqual([]);
  });
});
