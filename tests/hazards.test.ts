import { describe, expect, it } from "vitest";
import { fuseReports } from "@/lib/dedupe";
import { parseEfRating, parseWindMph } from "@/lib/hazard";
import { parseIemGeoJson, parseNwsAlerts, parseSpcTornadoCsv, parseSpcWindCsv } from "@/lib/parsers";

describe("wind and tornado parsing", () => {
  it("reads an SPC wind row in miles per hour", () => {
    const reports = parseSpcWindCsv(
      `Time,Speed,Location,County,State,Lat,Lon,Comments
1245,58,5 N WINTER HAVEN,POLK,FL,28.09,-81.73,TREES DOWN. (TBW)
1300,UNK,1 E TAMPA,HILLSBOROUGH,FL,27.95,-82.45,WIND DAMAGE. (TBW)
`,
      "2026-09-18",
    );
    expect(reports).toHaveLength(2);
    expect(reports[0].hazard).toBe("wind");
    expect(reports[0].windMph).toBe(58);
    expect(reports[0].sizeIn).toBeNull();
    expect(reports[0].state).toBe("FL");
    expect(reports[1].windMph).toBeNull();
  });

  it("reads an SPC tornado scale", () => {
    const reports = parseSpcTornadoCsv(
      `Time,F_Scale,Location,County,State,Lat,Lon,Comments
0134,EF1,1 ESE DAWSON,TERRELL,GA,31.77,-84.42,TORNADO REPORTED BY STORM SPOTTER. (TAE)
0200,UNK,2 N TEST,TEST,GA,31.80,-84.40,TORNADO. (TAE)
`,
      "2026-09-18",
    );
    expect(reports.map((item) => item.efRating)).toEqual(["EF1", "UNK"]);
    expect(reports.every((item) => item.hazard === "tornado")).toBe(true);
    expect(reports[0].confidence).toBe("spotter");
  });

  it("keeps IEM wind and tornado beside hail", () => {
    const reports = parseIemGeoJson({
      type: "FeatureCollection",
      features: [
        feature("HAIL", "H", { magf: 1, magnitude: "1.00", unit: "Inch", city: "Norman" }),
        feature("TSTM WND GST", "G", { magf: 70, magnitude: "70", unit: "MPH", city: "Moore" }),
        feature("TORNADO", "T", { magf: null, magnitude: "EF2", unit: "", city: "Newcastle" }),
        feature("FLOOD", "F", { magf: 1, magnitude: "1", city: "Ignore" }),
      ],
    });
    expect(reports.map((item) => item.hazard)).toEqual(["hail", "wind", "tornado"]);
    expect(reports[1].windMph).toBe(70);
    expect(reports[2].efRating).toBe("EF2");
    expect(reports[0].sizeIn).toBe(1);
  });

  it("converts a knot wind gust and an F-scale token", () => {
    expect(parseWindMph(50, "KT")).toBe(58);
    expect(parseEfRating("F3")).toBe("EF3");
    expect(parseEfRating("EFU")).toBe("EFU");
  });

  it("does not fuse a wind gust into a nearby hail report", () => {
    const fused = fuseReports([
      {
        id: "hail",
        lat: 35.22,
        lon: -97.44,
        occurredAt: "2026-09-18T18:00:00.000Z",
        sizeIn: 1.5,
        confidence: "nws",
        hazard: "hail",
      },
      {
        id: "wind",
        lat: 35.22,
        lon: -97.44,
        occurredAt: "2026-09-18T18:10:00.000Z",
        sizeIn: null,
        confidence: "nws",
        hazard: "wind",
        windMph: 65,
      },
    ]);
    expect(fused.map((item) => item.id).sort()).toEqual(["hail", "wind"]);
  });

  it("pulls hail size and wind speed from one warning", () => {
    const reports = parseNwsAlerts({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-97.6, 35.2],
                [-97.3, 35.2],
                [-97.3, 35.5],
                [-97.6, 35.5],
                [-97.6, 35.2],
              ],
            ],
          },
          properties: {
            id: "alert-1",
            event: "Severe Thunderstorm Warning",
            onset: "2026-09-18T18:00:00.000Z",
            areaDesc: "Cleveland, OK",
            headline: "Severe Thunderstorm Warning",
            description: "MAX HAIL SIZE...1.75 IN\nMAX WIND GUST...70 MPH",
          },
        },
      ],
    });
    expect(reports.map((item) => item.hazard).sort()).toEqual(["hail", "wind"]);
    expect(reports.find((item) => item.hazard === "hail")?.sizeIn).toBe(1.75);
    expect(reports.find((item) => item.hazard === "wind")?.windMph).toBe(70);
  });
});

function feature(typetext: string, type: string, properties: Record<string, unknown>) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [-97.44, 35.22] },
    properties: {
      typetext,
      type,
      st: "OK",
      valid: "2026-09-18T18:00:00.000Z",
      source: "Trained Spotter",
      ...properties,
    },
  };
}
