import { describe, expect, it } from "vitest";
import { manualReport, parseCsvImport, parseJsonImport } from "@/lib/submit";

describe("import parsing", () => {
  it("assigns distinct ids when the CSV has no id column", () => {
    const reports = parseCsvImport(`lat,lon,size,location
35.20,-97.40,1.00,Norman
35.50,-97.50,1.75,Moore
`);
    expect(reports).toHaveLength(2);
    expect(reports[0].externalId).not.toBe(reports[1].externalId);
    expect(reports[0].externalId.length).toBeGreaterThan(4);
    expect(reports[0].sizeIn).toBe(1);
    expect(reports[1].confidence).toBe("community");
  });

  it("keeps spotter confidence from a file and ignores an NWS claim", () => {
    const spotter = manualReport(
      { lat: 35, lon: -97, size: "quarter", confidence: "spotter" },
      "community",
      "import",
    );
    const spoof = manualReport(
      { lat: 35, lon: -97, size: "1.5", confidence: "nws" },
      "community",
      "import",
    );
    expect(spotter.ok && spotter.report.confidence).toBe("spotter");
    expect(spoof.ok && spoof.report.confidence).toBe("community");
  });

  it("reads GeoJSON points", () => {
    const reports = parseJsonImport(
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-104.99, 39.74] },
            properties: { size: "1.25", location: "Denver", remark: "broke a windshield" },
          },
        ],
      }),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].lat).toBe(39.74);
    expect(reports[0].lon).toBe(-104.99);
    expect(reports[0].sizeIn).toBe(1.25);
  });

  it("does not let a community webhook body claim NWS confidence", () => {
    const saved = manualReport(
      { lat: 36, lon: -96, size: "1", confidence: "nws" },
      "community",
      "community",
    );
    expect(saved.ok && saved.report.confidence).toBe("community");
  });
});
