import { describe, expect, it } from "vitest";
import { parseIemGeoJson, parseSpcHailCsv } from "@/lib/parsers";

describe("official LSR parsing", () => {
  it("keeps every hail report inside one IEM bulletin", () => {
    const product = "202609181445-KSLC-NWUS55-LSRSLC";
    const reports = parseIemGeoJson({
      type: "FeatureCollection",
      features: [
        feature({
          product_id: product,
          city: "1 W Holladay",
          county: "Salt Lake",
          lat: 40.67,
          lon: -111.84,
          valid: "2026-09-18T14:36:00Z",
          magf: 0.5,
          magnitude: "0.50",
          source: "Public",
          remark: "Report from mPING: Half-inch (0.50 in.).",
        }),
        feature({
          product_id: product,
          city: "7 NW Spanish Fork",
          county: "Utah",
          lat: 40.17,
          lon: -111.75,
          valid: "2026-09-18T14:41:00Z",
          magf: 0.5,
          magnitude: "0.50",
          source: "Public",
          remark: "Report from mPING: Half-inch (0.50 in.).",
        }),
      ],
    });

    expect(reports).toHaveLength(2);
    expect(new Set(reports.map((item) => item.externalId)).size).toBe(2);
    expect(reports.map((item) => item.location).sort()).toEqual(["1 W Holladay", "7 NW Spanish Fork"]);
    expect(reports.every((item) => item.confidence === "spotter")).toBe(true);
    expect(reports.every((item) => item.state === "UT")).toBe(true);
    expect(reports.every((item) => item.source === "iem")).toBe(true);
  });

  it("classifies an SPC mPING hail row as a spotter LSR", () => {
    const reports = parseSpcHailCsv(
      `Time,Size,Location,County,State,Lat,Lon,Comments
2210,100,2 SW Taylorsville,Salt Lake,UT,40.64,-111.95,Report from mPING: Quarter (1.00 in.). (SLC)
`,
      "2026-09-18",
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].confidence).toBe("spotter");
    expect(reports[0].state).toBe("UT");
    expect(reports[0].sizeIn).toBe(1);
    expect(reports[0].location).toBe("2 SW Taylorsville");
    expect(reports[0].source).toBe("spc");
  });
});

function feature(properties: Record<string, unknown>) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [properties.lon, properties.lat] },
    properties: {
      typetext: "HAIL",
      type: "H",
      st: "UT",
      state: "UT",
      unit: "Inch",
      ...properties,
    },
  };
}
