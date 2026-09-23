import { describe, expect, it } from "vitest";
import {
  applyReportFilter,
  DEFAULT_WINDOW_HOURS,
  emptyWindowMessage,
  LIVE_WINDOW_HOURS,
  refreshIntervalMs,
  reportsToPointCollection,
  TIME_WINDOWS,
  wantsFreshSync,
  windowPhrase,
  type ReportFilter,
} from "@/lib/filters";
import { boundsOf } from "@/lib/geo";
import type { HailReport } from "@/lib/types";

const NOW = Date.parse("2026-09-21T18:10:00.000Z");

function report(overrides: Partial<HailReport> & Pick<HailReport, "id">): HailReport {
  return {
    source: "iem",
    confidence: "spotter",
    lat: 40.64,
    lon: -111.95,
    sizeIn: 1,
    sizeRaw: "1.00",
    occurredAt: "2026-09-18T22:10:00.000Z",
    location: "2 SW Taylorsville",
    county: "Salt Lake",
    state: "UT",
    remark: "Report from mPING: Quarter (1.00 in.).",
    damageTags: [],
    ...overrides,
  };
}

const WASATCH: HailReport[] = [
  report({ id: "taylorsville", lat: 40.64, lon: -111.95, occurredAt: "2026-09-18T22:10:00.000Z", sizeIn: 1 }),
  report({
    id: "holladay",
    lat: 40.67,
    lon: -111.84,
    occurredAt: "2026-09-18T14:36:00.000Z",
    sizeIn: 0.5,
    location: "1 W Holladay",
  }),
  report({
    id: "layton",
    lat: 41.09,
    lon: -111.96,
    occurredAt: "2026-09-18T21:32:00.000Z",
    sizeIn: 0.75,
    location: "1 NW Layton",
    county: "Davis",
  }),
  report({
    id: "brigham",
    lat: 41.51,
    lon: -112.02,
    occurredAt: "2026-09-18T18:00:00.000Z",
    sizeIn: 0.5,
    location: "Brigham City",
    county: "Box Elder",
  }),
  report({
    id: "spanish-fork",
    lat: 40.17,
    lon: -111.75,
    occurredAt: "2026-09-18T14:41:00.000Z",
    sizeIn: 0.5,
    location: "7 NW Spanish Fork",
    county: "Utah",
  }),
  report({
    id: "kaysville",
    lat: 41.03,
    lon: -111.95,
    occurredAt: "2026-09-18T19:45:00.000Z",
    sizeIn: 1.5,
    location: "2 W Kaysville",
    county: "Davis",
  }),
];

const OPEN: ReportFilter = {
  minSize: 0,
  hours: 168,
  confidences: ["nws", "spotter", "mesh", "community"],
  state: "",
};

describe("7-day Wasatch filter and point layer", () => {
  it("hides 18 September Utah reports at 24h and renders them at 7 days", () => {
    const day = applyReportFilter(WASATCH, { ...OPEN, hours: 24 }, NOW);
    expect(day).toHaveLength(0);

    const week = applyReportFilter(WASATCH, OPEN, NOW);
    expect(week.map((item) => item.id).sort()).toEqual(WASATCH.map((item) => item.id).sort());

    const points = reportsToPointCollection(week);
    expect(points.type).toBe("FeatureCollection");
    expect(points.features).toHaveLength(WASATCH.length);
    const holladay = points.features.find((feature) => feature.properties?.id === "holladay");
    expect(holladay?.geometry.type).toBe("Point");
    expect(holladay?.geometry.coordinates).toEqual([-111.84, 40.67]);
    expect(holladay?.properties?.confidence).toBe("spotter");
    expect(holladay?.properties?.sizeIn).toBe(0.5);

    const bounds = boundsOf(week);
    expect(bounds).not.toBeNull();
    expect(bounds!.west).toBeLessThan(-112);
    expect(bounds!.east).toBeGreaterThan(-111.75);
    expect(bounds!.south).toBeLessThan(40.17);
    expect(bounds!.north).toBeGreaterThan(41.51);
  });

  it("keeps Utah spotter LSRs when community is toggled off and flies to a UT filter", () => {
    const mixed = [
      ...WASATCH,
      report({
        id: "webhook",
        confidence: "community",
        source: "community",
        lat: 40.7,
        lon: -111.9,
        location: "Imported ping",
      }),
      report({
        id: "denver",
        state: "CO",
        lat: 39.74,
        lon: -104.99,
        location: "Denver",
        occurredAt: "2026-09-21T16:00:00.000Z",
      }),
    ];
    const visible = applyReportFilter(
      mixed,
      { ...OPEN, confidences: ["nws", "spotter", "mesh"], state: "UT" },
      NOW,
    );
    expect(visible.map((item) => item.id).sort()).toEqual(WASATCH.map((item) => item.id).sort());
    const points = reportsToPointCollection(visible);
    expect(points.features.every((feature) => feature.geometry.type === "Point")).toBe(true);
    expect(points.features.some((feature) => feature.properties?.id === "taylorsville")).toBe(true);
  });

  it("marks photo reports on the map points", () => {
    const points = reportsToPointCollection([
      report({ id: "photo", photoUrl: "/api/photos/11111111-1111-4111-8111-111111111111" }),
      report({ id: "plain" }),
    ]);
    expect(points.features[0].properties?.hasPhoto).toBe(1);
    expect(points.features[1].properties?.hasPhoto).toBe(0);
  });
});

describe("live and 1 hour windows", () => {
  const recent = report({ id: "recent", occurredAt: new Date(NOW - 20 * 60 * 1000).toISOString() });
  const forty = report({ id: "forty", occurredAt: new Date(NOW - 44 * 60 * 1000).toISOString() });
  const atLiveEdge = report({ id: "edge", occurredAt: new Date(NOW - 45 * 60 * 1000).toISOString() });
  const justOlderThanLive = report({
    id: "past-live",
    occurredAt: new Date(NOW - 45 * 60 * 1000 - 1).toISOString(),
  });
  const fifty = report({ id: "fifty", occurredAt: new Date(NOW - 50 * 60 * 1000).toISOString() });
  const atHourEdge = report({ id: "hour-edge", occurredAt: new Date(NOW - 60 * 60 * 1000).toISOString() });
  const ninety = report({ id: "ninety", occurredAt: new Date(NOW - 90 * 60 * 1000).toISOString() });
  const rows = [recent, forty, atLiveEdge, justOlderThanLive, fifty, atHourEdge, ninety];

  it("places Live and 1 hour first and keeps 7 days as the default", () => {
    expect(TIME_WINDOWS.map((item) => item.hours)).toEqual([LIVE_WINDOW_HOURS, 1, 6, 24, 72, 168]);
    expect(TIME_WINDOWS.map((item) => item.label)).toEqual([
      "Live",
      "1 hour",
      "6 hours",
      "24 hours",
      "3 days",
      "7 days",
    ]);
    expect(LIVE_WINDOW_HOURS).toBe(0.75);
    expect(DEFAULT_WINDOW_HOURS).toBe(168);
    expect(windowPhrase(LIVE_WINDOW_HOURS)).toBe("Live · last 45 minutes");
    expect(windowPhrase(1)).toBe("Last 1 hour");
    expect(windowPhrase(168)).toBe("Last 7 days");
  });

  it("keeps the last 45 minutes on Live and the last 60 minutes on 1 hour", () => {
    expect(applyReportFilter(rows, { ...OPEN, hours: LIVE_WINDOW_HOURS }, NOW).map((item) => item.id)).toEqual([
      "recent",
      "forty",
      "edge",
    ]);
    expect(applyReportFilter(rows, { ...OPEN, hours: 1 }, NOW).map((item) => item.id)).toEqual([
      "recent",
      "forty",
      "edge",
      "past-live",
      "fifty",
      "hour-edge",
    ]);
    expect(applyReportFilter(WASATCH, { ...OPEN, hours: LIVE_WINDOW_HOURS }, NOW)).toEqual([]);
    expect(applyReportFilter(WASATCH, { ...OPEN, hours: 1 }, NOW)).toEqual([]);
    expect(applyReportFilter(WASATCH, OPEN, NOW)).toHaveLength(WASATCH.length);
  });

  it("refreshes Live and 1 hour faster than the weekly window", () => {
    expect(refreshIntervalMs(LIVE_WINDOW_HOURS)).toBe(30_000);
    expect(refreshIntervalMs(1)).toBe(60_000);
    expect(refreshIntervalMs(6)).toBe(5 * 60 * 1000);
    expect(refreshIntervalMs(168)).toBe(5 * 60 * 1000);
    expect(wantsFreshSync(LIVE_WINDOW_HOURS)).toBe(true);
    expect(wantsFreshSync(1)).toBe(true);
    expect(wantsFreshSync(24)).toBe(false);
    expect(wantsFreshSync(168)).toBe(false);
  });

  it("says when a short window has no reports yet", () => {
    expect(emptyWindowMessage(LIVE_WINDOW_HOURS)).toBe("No hail reports in the last 45 minutes yet.");
    expect(emptyWindowMessage(1)).toBe("No hail reports in the last hour yet.");
    expect(emptyWindowMessage(6)).toBe("No hail reports in this window.");
    expect(emptyWindowMessage(168)).toBe("No hail reports in this window.");
    expect(applyReportFilter(rows, { ...OPEN, hours: 6 }, NOW)).toHaveLength(rows.length);
  });
});
