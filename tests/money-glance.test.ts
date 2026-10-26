import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HoneyPanel from "@/components/panels/HoneyPanel";
import { MoneyGlanceCard } from "@/components/map/MoneyGlance";
import { HONEY_CITY_SPAN_KM } from "@/lib/honey";
import {
  MONEY_ZOOM_HINT,
  areasFollowMap,
  glanceAt,
  honeyQueryFromMap,
  type GlancePlace,
} from "@/lib/money-glance";

const bounds = { west: -100, south: 30, east: -90, north: 40 };

const fortWorth: GlancePlace = {
  id: "32.75,-97.33:2026-05-10",
  name: "Fort Worth, TX",
  lat: 32.75,
  lon: -97.33,
  score: 82,
  level: "High",
  hailIn: 2.2,
  radarIn: 2.2,
  spotterIn: 1.75,
  count: 1608,
  noun: "cars",
  bounds: { west: -97.6, south: 32.5, east: -97.05, north: 33.0 },
};

const lot: GlancePlace = {
  id: "lot-1",
  name: "West 7th lot",
  lat: 32.75,
  lon: -97.36,
  score: 74,
  level: "High",
  hailIn: 1.75,
  radarIn: 1.75,
  spotterIn: null,
  count: 420,
  noun: "cars",
};

describe("money hole follows the map", () => {
  it("ranks the default week without a storm day", () => {
    const query = honeyQueryFromMap({
      bounds,
      historyKind: "window",
      day: null,
      hours: 168,
      originLat: null,
      originLon: null,
    });
    expect(query).toContain("hours=168");
    expect(query).not.toContain("date=");
    expect(areasFollowMap({ historyKind: "window", hours: 168, date: null, chaseStart: "2026-05-04", chaseEnd: "2026-05-10" })).toBe(true);
    expect(areasFollowMap({ historyKind: "window", hours: 24, date: null, chaseStart: "2026-05-04", chaseEnd: "2026-05-10" })).toBe(false);
    expect(HONEY_CITY_SPAN_KM).toBe(210);
  });

  it("still uses a storm day when the map is already on one", () => {
    const query = honeyQueryFromMap({
      bounds,
      historyKind: "day",
      day: "2026-05-10",
      hours: 168,
      originLat: 32.7,
      originLon: -97.3,
    });
    expect(query).toContain("date=2026-05-10");
    expect(query).not.toContain("hours=");
    expect(areasFollowMap({ historyKind: "day", hours: 168, date: "2026-05-10", chaseStart: "2026-05-04", chaseEnd: "2026-05-10" })).toBe(true);
    expect(areasFollowMap({ historyKind: "day", hours: 168, date: "2026-04-01", chaseStart: "2026-05-04", chaseEnd: "2026-05-10" })).toBe(false);
  });

  it("does not invent a query for hail-day history with no hail path", () => {
    expect(
      honeyQueryFromMap({
        bounds,
        historyKind: "days",
        day: null,
        hours: 168,
        originLat: null,
        originLon: null,
      }),
    ).toBe("");
  });
});

describe("hover or tap score", () => {
  it("shows the ranked area score on a hail path when the map is zoomed out", () => {
    const result = glanceAt(
      { lat: 32.8, lon: -97.4 },
      { spots: [], areas: [fortWorth], zoomedOut: true, loading: false },
    );
    expect(result.score).toMatchObject({ id: fortWorth.id, name: "Fort Worth, TX", score: 82 });
    expect(result.score?.detail).toContain("1,608 cars");
    expect(result.hint).toBeNull();
  });

  it("uses the money spot inside the hail path instead of the wider area", () => {
    const result = glanceAt(
      {
        lat: 32.75,
        lon: -97.36,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-97.5, 32.6],
              [-97.2, 32.6],
              [-97.2, 32.9],
              [-97.5, 32.9],
              [-97.5, 32.6],
            ],
          ],
        },
      },
      { spots: [lot], areas: [fortWorth], zoomedOut: false, loading: false },
    );
    expect(result.score?.id).toBe("lot-1");
    expect(result.score?.score).toBe(74);
  });

  it("asks for a closer look when a zoomed-out path has no score yet", () => {
    const result = glanceAt({ lat: 40, lon: -100 }, { spots: [], areas: [fortWorth], zoomedOut: true, loading: false });
    expect(result.score).toBeNull();
    expect(result.hint).toBe(MONEY_ZOOM_HINT);
    expect(result.hint).not.toMatch(/storm day/i);
  });

  it("renders the score card without a dollar amount", () => {
    const html = renderToStaticMarkup(
      createElement(MoneyGlanceCard, {
        score: { id: "area", name: "Fort Worth, TX", score: 82, level: "High", detail: 'Hail: 2.2" radar, 1.75" spotter · 1,608 cars' },
        hint: null,
      }),
    );
    expect(html).toContain('data-money-glance');
    expect(html).toContain("Money Hole");
    expect(html).toContain("82");
    expect(html).toContain("Fort Worth, TX");
    expect(html).not.toMatch(/\$|dollar/i);
  });
});

describe("money hole sheet", () => {
  const spot = {
    id: "lot-1",
    name: "West 7th lot",
    kind: "dealership",
    lat: 32.75,
    lon: -97.36,
    hailIn: 1.75,
    radarIn: 1.75,
    spotterIn: null,
    vehicles: 420,
    homes: null,
    score: 74,
    level: "High",
    distanceKm: null,
    sourceLabel: "Radar",
  };

  it("does not open on a pick-a-day prompt when the map already has a week of hail", () => {
    const html = renderToStaticMarkup(
      createElement(HoneyPanel, {
        label: "Last 7 days",
        mode: "pdr",
        onMode: () => undefined,
        showHeat: false,
        onToggleHeat: () => undefined,
        loading: false,
        note: null,
        error: null,
        spots: [{ ...spot, id: fortWorth.id, name: "Fort Worth, TX", kind: "area", score: 82, vehicles: 1608 }],
        selectedId: null,
        onSelect: () => undefined,
        onClose: () => undefined,
        attribution: null,
        needsDay: true,
        zoomedOut: true,
        distanceFrom: null,
        showActions: false,
      }),
    );
    expect(html).toContain("Last 7 days");
    expect(html).toContain("Fort Worth, TX");
    expect(html).toContain("82");
    expect(html).not.toContain("Pick a storm day");
    expect(html).not.toContain("Pick the day the hail fell");
    expect(html).not.toContain("Scores follow the hail on the map.");
    expect(html).not.toContain("Door-knock route");
    expect(html).not.toContain("Storm-to-cash estimate");
  });

  it("shows door-knock only after a spot is chosen, under the score", () => {
    const html = renderToStaticMarkup(
      createElement(HoneyPanel, {
        label: "Last 7 days",
        mode: "pdr",
        onMode: () => undefined,
        showHeat: false,
        onToggleHeat: () => undefined,
        loading: false,
        note: null,
        error: null,
        spots: [spot],
        selectedId: spot.id,
        onSelect: () => undefined,
        onClose: () => undefined,
        attribution: null,
        needsDay: false,
        zoomedOut: false,
        distanceFrom: null,
        showActions: true,
        onRoute: () => undefined,
        onForecast: () => undefined,
      }),
    );
    expect(html.indexOf("West 7th lot")).toBeLessThan(html.indexOf("Door-knock route"));
    expect(html.indexOf("West 7th lot")).toBeLessThan(html.indexOf("Storm-to-cash estimate"));
  });

  it("shows the zoom hint when a wide map has no scored area yet", () => {
    const html = renderToStaticMarkup(
      createElement(HoneyPanel, {
        label: "Last 7 days",
        mode: "pdr",
        onMode: () => undefined,
        showHeat: false,
        onToggleHeat: () => undefined,
        loading: false,
        note: null,
        error: null,
        spots: [],
        selectedId: null,
        onSelect: () => undefined,
        onClose: () => undefined,
        attribution: null,
        needsDay: false,
        zoomedOut: true,
        distanceFrom: null,
        showActions: false,
      }),
    );
    expect(html).toContain(MONEY_ZOOM_HINT);
    expect(html).not.toContain("Pick a storm day");
  });
});
