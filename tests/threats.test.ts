import { describe, expect, it } from "vitest";
import { alertsToFeatures, assembleThreats, outlookToFeatures, significantToFeatures } from "@/lib/threats";

const NOW = Date.parse("2026-09-22T18:00:00Z");

describe("NWS severe threat polygons", () => {
  it("keeps tornado and severe thunderstorm watches and warnings", () => {
    const features = alertsToFeatures({
      type: "FeatureCollection",
      features: [
        alert("Tornado Warning", {
          id: "tor-1",
          senderName: "NWS Norman OK",
          ends: "2026-09-22T19:15:00-05:00",
          areaDesc: "Cleveland, OK",
          description: "HAZARD...Tornado.\n\nSOURCE...Radar indicated.",
          parameters: { tornadoDetection: ["RADAR INDICATED"], tornadoDamageThreat: ["CATASTROPHIC"], maxHailSize: ["1.75"] },
        }),
        alert("Severe Thunderstorm Warning", {
          id: "svr-1",
          senderName: "NWS Jackson KY",
          ends: "2026-09-22T20:30:00-04:00",
          areaDesc: "Breathitt, KY",
          description: "HAZARD...60 mph wind gusts and quarter size hail.",
          parameters: { maxHailSize: ["1.00"], maxWindGust: ["60 MPH"] },
        }),
        alert("Tornado Watch", {
          id: "watch-tor",
          senderName: "NWS Storm Prediction Center Norman OK",
          expires: "2026-09-23T01:00:00Z",
          areaDesc: "Central Oklahoma",
        }),
        alert("Severe Thunderstorm Watch", {
          id: "watch-svr",
          senderName: "NWS Storm Prediction Center Norman OK",
          ends: "2026-09-23T02:00:00Z",
          areaDesc: "North Texas",
        }),
      ],
    });

    expect(features.map((feature) => feature.properties.event)).toEqual([
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Tornado Watch",
      "Severe Thunderstorm Watch",
    ]);
    expect(features[0].properties.kind).toBe("warning");
    expect(features[0].properties.office).toBe("NWS Norman OK");
    expect(features[0].properties.until).toBe("2026-09-22T19:15:00-05:00");
    expect(features[0].properties.hazard).toContain("Tornado");
    expect(features[0].properties.hazard).toContain("1.75 inch hail");
    expect(features[0].properties.hazard).toContain("tornado emergency");
    expect(features[1].properties.hazard).toBe("60 mph wind gusts and quarter size hail.");
    expect(features[1].properties.area).toBe("Breathitt, KY");
    expect(features[2].properties.kind).toBe("watch");
    expect(features[2].properties.hazard).toMatch(/favorable for tornadoes/i);
    expect(features[3].geometry.type).toBe("Polygon");
  });

  it("includes a hail special weather statement and skips other alerts", () => {
    const features = alertsToFeatures({
      type: "FeatureCollection",
      features: [
        alert("Special Weather Statement", {
          id: "sps-hail",
          senderName: "NWS Pueblo CO",
          ends: "2026-09-22T19:00:00-06:00",
          areaDesc: "El Paso, CO",
          description: "A strong storm will move through Colorado Springs. Penny size hail is possible. Heavy rain is also expected.",
        }),
        alert("Special Weather Statement", {
          id: "sps-wind",
          description: "Gusty winds and blowing dust are expected this afternoon.",
        }),
        alert("Flood Warning", { id: "flood" }),
        alert("Severe Thunderstorm Warning", { id: "no-geom", geometry: null }),
        alert("Tornado Warning", {
          id: "cancel",
          messageType: "Cancel",
          description: "HAZARD...Tornado.",
        }),
      ],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties.kind).toBe("statement");
    expect(features[0].properties.office).toBe("NWS Pueblo CO");
    expect(features[0].properties.hazard).toMatch(/penny size hail/i);
  });

  it("builds a warning from hail and wind parameters when the hazard line is missing", () => {
    const features = alertsToFeatures({
      type: "FeatureCollection",
      features: [
        alert("Severe Thunderstorm Warning", {
          id: "svr-params",
          description: "At 420 PM CDT, a severe thunderstorm was located near Norman.",
          parameters: { maxHailSize: ["Up to 1.75"], maxWindGust: ["70 MPH"], thunderstormDamageThreat: ["CONSIDERABLE"] },
        }),
      ],
    });
    expect(features[0].properties.hazard).toBe(
      "70 mph wind gusts and up to 1.75 inch hail. Damage threat is considerable.",
    );
  });
});

describe("SPC Day 1 outlook polygons", () => {
  it("maps categorical risk and skips general thunder and expired areas", () => {
    const features = outlookToFeatures(
      {
        type: "FeatureCollection",
        features: [
          outlook("TSTM", 2, "General Thunderstorms Risk"),
          outlook("MRGL", 3, "Marginal Risk", { fill: "#66A366", stroke: "#005500" }),
          outlook("SLGT", 4, "Slight Risk"),
          outlook("HIGH", 8, "High Risk", { expire: "2026-09-21T12:00:00+00:00" }),
          outlook("", 5, "Enhanced Risk"),
        ],
      },
      NOW,
    );

    expect(features.map((feature) => feature.properties.category)).toEqual(["marginal", "slight", "enhanced"]);
    expect(features[0].properties.event).toBe("Marginal risk");
    expect(features[0].properties.office).toBe("Storm Prediction Center");
    expect(features[0].properties.hazard).toMatch(/isolated severe storms/i);
    expect(features[0].properties.fill).toBe("#66A366");
    expect(features[0].properties.until).toBe("2026-09-23T12:00:00+00:00");
    expect(features[2].properties.event).toBe("Enhanced risk");
  });

  it("keeps a current significant-severe hatch and drops an empty stale file", () => {
    const live = significantToFeatures(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: box(),
            properties: {
              DN: 10,
              LABEL: "SIGN",
              LABEL2: "10% Significant Hail Risk",
              VALID: "202609221630",
              EXPIRE_ISO: "2026-09-23T12:00:00+00:00",
            },
          },
        ],
      },
      "hail",
      NOW,
    );
    const stale = significantToFeatures(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "GeometryCollection", geometries: [] },
            properties: { DN: 0, LABEL: "", EXPIRE_ISO: "2026-03-04T12:00:00+00:00" },
          },
        ],
      },
      "hail",
      NOW,
    );

    expect(stale).toEqual([]);
    expect(live).toHaveLength(1);
    expect(live[0].properties.kind).toBe("significant");
    expect(live[0].properties.event).toBe("Significant hail");
    expect(live[0].properties.hazard).toMatch(/2 inches or larger/);
  });

  it("stacks higher categorical risk above lower risk and reports feed status", () => {
    const assembled = assembleThreats({
      now: NOW,
      alerts: { type: "FeatureCollection", features: [alert("Tornado Watch", { id: "w1" })] },
      categorical: {
        type: "FeatureCollection",
        features: [outlook("MDT", 6, "Moderate Risk"), outlook("MRGL", 3, "Marginal Risk")],
      },
      significant: [{ product: "tornado", payload: null }],
    });

    expect(assembled.status).toEqual({ nws: "ok", spc: "ok" });
    expect(assembled.features.map((feature) => feature.properties.event)).toEqual([
      "Marginal risk",
      "Moderate risk",
      "Tornado Watch",
    ]);

    const failed = assembleThreats({
      now: NOW,
      alerts: null,
      categorical: null,
      significant: [
        { product: "hail", payload: null },
        { product: "tornado", payload: null },
        { product: "wind", payload: null },
      ],
    });
    expect(failed.status).toEqual({ nws: "error", spc: "error" });
    expect(failed.features).toEqual([]);
  });
});

function alert(event: string, extra: Record<string, unknown> = {}) {
  const { geometry, ...properties } = extra;
  return {
    type: "Feature",
    geometry: geometry === undefined ? box() : geometry,
    properties: {
      event,
      status: "Actual",
      messageType: "Alert",
      senderName: "NWS Test",
      ...properties,
    },
  };
}

function outlook(
  label: string,
  dn: number,
  label2: string,
  options: { fill?: string; stroke?: string; expire?: string } = {},
) {
  return {
    type: "Feature",
    geometry: box(),
    properties: {
      DN: dn,
      LABEL: label,
      LABEL2: label2,
      VALID: "202609221630",
      EXPIRE_ISO: options.expire ?? "2026-09-23T12:00:00+00:00",
      fill: options.fill,
      stroke: options.stroke,
    },
  };
}

function box() {
  return {
    type: "Polygon",
    coordinates: [
      [
        [-97.6, 35.2],
        [-97.2, 35.2],
        [-97.2, 35.6],
        [-97.6, 35.6],
        [-97.6, 35.2],
      ],
    ],
  };
}
