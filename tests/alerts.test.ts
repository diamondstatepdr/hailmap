import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  alertCopy,
  alertLink,
  matchAreas,
  meshCandidates,
  outlookCandidates,
  reportCandidates,
  warningCandidates,
  type HailCandidate,
  type WatchTarget,
} from "@/lib/alert-match";
import { formatInches, inQuietHours, parseAlertLink } from "@/lib/alert-model";
import { stateOf } from "@/lib/state-locate";
import { alertsToFeatures } from "@/lib/threats";
import type { ThreatFeature } from "@/lib/threats";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-alerts-"));
process.env.HAILMAP_DATA_DIR = dataDir;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const locate = {
  stateOf: (lat: number) => (lat > 25 && lat < 37 && true ? "TX" : null),
  intersects: () => false,
};

function pointArea(overrides: Partial<WatchTarget> = {}): WatchTarget {
  return {
    id: "area-1",
    kind: "point",
    label: "4 SW Crowell, TX",
    lat: 33.93,
    lon: -99.75,
    radiusMi: 25,
    state: null,
    minSizeIn: 0,
    mesh: true,
    reports: true,
    warnings: true,
    outlook: false,
    ...overrides,
  };
}

describe("hail alert matching", () => {
  it("pings a watched point for a spotter report inside the radius and skips a far one", () => {
    const reports = reportCandidates([
      {
        id: "spc:crowell",
        lat: 33.93,
        lon: -99.75,
        sizeIn: 1.75,
        occurredAt: "2026-10-14T20:07:00Z",
        location: "4 SW Crowell",
        state: "TX",
      },
      {
        id: "spc:dallas",
        lat: 32.78,
        lon: -96.8,
        sizeIn: 1,
        occurredAt: "2026-10-14T21:00:00Z",
        location: "Dallas",
        state: "TX",
      },
    ]);
    const hits = matchAreas([pointArea({ radiusMi: 10 })], reports, locate);
    expect(hits.map((hit) => hit.candidate.place)).toEqual(["4 SW Crowell, TX"]);
    expect(hits[0].candidate.stormKey).toContain("report:2026-10-14");
    const copy = alertCopy(hits[0].candidate, "America/Chicago");
    expect(copy.title).toBe('1.75" hail · 4 SW Crowell, TX');
    expect(copy.body).toMatch(/Spotter report/);
    expect(alertLink(hits[0].candidate, pointArea())).toContain("card=address");
    expect(alertLink(hits[0].candidate, pointArea())).toContain("reportId=spc%3Acrowell");
  });

  it("keeps one report per storm cell and honors the size threshold", () => {
    const reports = reportCandidates([
      {
        id: "a",
        lat: 33.93,
        lon: -99.75,
        sizeIn: 1,
        occurredAt: "2026-10-14T20:00:00Z",
        location: "Crowell",
        state: "TX",
      },
      {
        id: "b",
        lat: 33.91,
        lon: -99.72,
        sizeIn: 1.75,
        occurredAt: "2026-10-14T20:10:00Z",
        location: "Crowell",
        state: "TX",
      },
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0].sizeIn).toBe(1.75);
    expect(matchAreas([pointArea({ minSizeIn: 2 })], reports, locate)).toHaveLength(0);
    expect(matchAreas([pointArea({ minSizeIn: 1.5, reports: true, mesh: false })], reports, locate)).toHaveLength(1);
  });

  it("matches a radar swath that covers the point and a whole state", () => {
    const swath = meshCandidates(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-100.2, 33.5],
                  [-99.4, 33.5],
                  [-99.4, 34.3],
                  [-100.2, 34.3],
                  [-100.2, 33.5],
                ],
              ],
            },
            properties: { minIn: 0.75, maxIn: 1.75 },
          },
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [-99.9, 33.8],
                  [-99.6, 33.8],
                  [-99.6, 34.0],
                  [-99.9, 34.0],
                  [-99.9, 33.8],
                ],
              ],
            },
            properties: { minIn: 1.5, maxIn: 1.75 },
          },
        ],
      },
      "2026-10-14T21:00:00Z",
      () => "4 SW Crowell, TX",
    );
    expect(swath).toHaveLength(1);
    expect(swath[0].sizeIn).toBe(1.75);
    const sameCell = meshCandidates(
      {
        type: "FeatureCollection",
        features: [0.9, 2.1].map((maxIn, index) => ({
          type: "Feature" as const,
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [-102.2 + index * 0.05, 31.7],
                [-102.05 + index * 0.05, 31.7],
                [-102.05 + index * 0.05, 31.85],
                [-102.2 + index * 0.05, 31.85],
                [-102.2 + index * 0.05, 31.7],
              ],
            ],
          },
          properties: { minIn: 0.75, maxIn },
        })),
      },
      "2026-10-14T21:00:00Z",
      () => "west Texas",
    );
    expect(sameCell).toHaveLength(1);
    expect(sameCell[0].sizeIn).toBe(2.1);
    const hits = matchAreas(
      [pointArea({ radiusMi: 5, lat: 33.7, lon: -99.9 }), { ...pointArea(), id: "tx", kind: "state", state: "TX", lat: null, lon: null }],
      swath,
      locate,
    );
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.candidate.kind === "mesh")).toBe(true);
  });

  it("sends hail warnings, assumes 1 inch for a severe thunderstorm warning, and skips wind-only text", () => {
    const features = alertsToFeatures({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-100, 33.5],
                [-99.5, 33.5],
                [-99.5, 34.2],
                [-100, 34.2],
                [-100, 33.5],
              ],
            ],
          },
          properties: {
            id: "svr-wind",
            event: "Severe Thunderstorm Warning",
            messageType: "Alert",
            status: "Actual",
            description: "HAZARD...60 mph wind gusts.",
            parameters: { maxWindGust: ["60 MPH"] },
            areaDesc: "Foard, TX",
          },
        },
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-100, 33.5],
                [-99.5, 33.5],
                [-99.5, 34.2],
                [-100, 34.2],
                [-100, 33.5],
              ],
            ],
          },
          properties: {
            id: "svr-hail",
            event: "Severe Thunderstorm Warning",
            messageType: "Alert",
            status: "Actual",
            description: "HAZARD...60 mph wind gusts and quarter size hail.",
            parameters: { maxHailSize: ["1.75"] },
            areaDesc: "Foard, TX",
          },
        },
      ],
    }) as ThreatFeature[];
    expect(features[0].properties.mentionsHail).toBe(false);
    expect(features[1].properties.mentionsHail).toBe(true);
    expect(features[1].properties.hailIn).toBe(1.75);
    const warnings = warningCandidates(features, new Date("2026-10-14T20:10:00Z"));
    expect(warnings.map((item) => item.stormKey)).toEqual(["warning:svr-hail"]);
    expect(matchAreas([pointArea({ minSizeIn: 1.5, mesh: false, reports: false })], warnings, locate)).toHaveLength(1);
    const unknown = warningCandidates(
      [
        {
          ...features[1],
          properties: { ...features[1].properties, id: "svr-plain", hailIn: null, mentionsHail: true },
        },
      ],
      new Date("2026-10-14T20:10:00Z"),
    );
    expect(unknown[0].sizeIn).toBe(1);
    expect(unknown[0].sizeKnown).toBe(false);
    expect(alertCopy(unknown[0], "America/Chicago").title.startsWith("Hail ·")).toBe(true);
    expect(matchAreas([pointArea({ minSizeIn: 1.5, mesh: false, reports: false })], unknown, locate)).toHaveLength(0);
  });

  it("collapses the SPC outlook to one heads-up", () => {
    const outlook: HailCandidate[] = outlookCandidates(
      [
        feature("outlook", "marginal", 0.75),
        feature("outlook", "enhanced", 1.5),
        feature("significant", "significant", 2),
      ],
      new Date("2026-10-14T18:00:00Z"),
    );
    const hits = matchAreas([pointArea({ outlook: true, mesh: false, reports: false, warnings: false, minSizeIn: 1 })], outlook, locate);
    expect(hits).toHaveLength(1);
    expect(hits[0].candidate.sizeIn).toBe(2);
    expect(hits[0].candidate.stormKey).toBe("outlook:2026-10-14");
    expect(alertCopy(hits[0].candidate, "America/Chicago").title).toContain('2"+ hail possible');
  });

  it("locates west Texas inside the state polygon", () => {
    expect(stateOf(31.87, -102.38)).toBe("TX");
    expect(stateOf(33.93, -99.75)).toBe("TX");
    expect(stateOf(35.47, -97.52)).toBe("OK");
  });
});

describe("quiet hours and deep links", () => {
  it("holds alerts overnight and lets the morning through", () => {
    const evening = new Date("2026-10-15T03:30:00Z");
    const morning = new Date("2026-10-15T14:30:00Z");
    expect(inQuietHours(evening, "22:00", "07:00", "America/Chicago")).toBe(true);
    expect(inQuietHours(morning, "22:00", "07:00", "America/Chicago")).toBe(false);
    expect(inQuietHours(evening, null, null, "America/Chicago")).toBe(false);
  });

  it("reads a notification deep link", () => {
    const target = parseAlertLink("/?focusLat=33.93&focusLon=-99.75&focusZoom=10&reportId=spc:crowell&card=address&cardLat=33.93&cardLon=-99.75&cardLabel=Crowell");
    expect(target.focus).toEqual({ lat: 33.93, lon: -99.75, zoom: 10 });
    expect(target.reportId).toBe("spc:crowell");
    expect(target.card?.label).toBe("Crowell");
    expect(formatInches(2)).toBe('2"');
  });

  it("opens the alerts inbox without inventing a map focus", () => {
    const target = parseAlertLink("http://127.0.0.1:3000/?section=alerts");
    expect(target.section).toBe("alerts");
    expect(target.focus).toBeNull();
    expect(target.card).toBeNull();
    expect(target.reportId).toBeNull();
  });
});

describe("alert storage", () => {
  it("stores one alert per storm cell and keeps VAPID keys on disk", async () => {
    const store = await import("@/lib/alert-store");
    const vapid = await import("@/lib/vapid");
    const device = store.saveSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/test-token",
      p256dh: "key",
      auth: "auth",
      timeZone: "America/Chicago",
    });
    const created = store.addArea(device.id, {
      kind: "point",
      label: "Crowell",
      lat: 33.93,
      lon: -99.75,
      radiusMi: 25,
      minSizeIn: 1,
    });
    expect("area" in created).toBe(true);
    if (!("area" in created)) return;
    const event = {
      subscriptionId: device.id,
      areaId: created.area.id,
      stormKey: "report:2026-10-14:34:-100",
      kind: "report" as const,
      title: '1.75" hail · Crowell, TX',
      body: "Spotter report · 3:07 PM",
      place: "Crowell, TX",
      sizeIn: 1.75,
      occurredAt: "2026-10-14T20:07:00Z",
      lat: 33.93,
      lon: -99.75,
      url: "/?focusLat=33.93&focusLon=-99.75",
    };
    expect(store.claimEvent(event)?.id).toBeTruthy();
    expect(store.claimEvent(event)).toBeNull();
    expect(store.listInbox(device.id)).toHaveLength(1);
    store.markEvent(store.listInbox(device.id)[0].id, "expired");
    store.deleteDevice(device.id);
    expect(store.deviceFromKey(device.deviceKey)).toBeNull();

    const first = vapid.getVapid();
    expect(first.source).toBe("file");
    vapid.resetVapidCache();
    const second = vapid.getVapid();
    expect(second.publicKey).toBe(first.publicKey);
    expect(second.privateKey).toBe(first.privateKey);
  });
});

function feature(kind: "outlook" | "significant", category: string, hailIn: number): ThreatFeature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-102, 31],
          [-98, 31],
          [-98, 35],
          [-102, 35],
          [-102, 31],
        ],
      ],
    },
    properties: {
      id: `${kind}-${category}`,
      kind,
      event: kind === "significant" ? "Significant hail" : "Enhanced risk",
      category,
      office: "Storm Prediction Center",
      until: "2026-10-15T12:00:00Z",
      hazard: "Hail is possible.",
      area: "",
      fill: "#FFA366",
      stroke: "#FF6600",
      rank: 3,
      mentionsHail: true,
      hailIn,
    },
  };
}
