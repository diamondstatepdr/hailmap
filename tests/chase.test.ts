import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import ChasePopup from "@/components/chase/ChasePopup";
import { ChaseSection } from "@/components/chase/ChaseList";
import { cachedChase, readChaseCache, writeChaseCache } from "@/lib/chase-cache";
import {
  CHASE_PREVIEW,
  chaseListIsNew,
  chasePopupKey,
  chaseViewedKey,
  clusterChaseHits,
  isoWeekKey,
  rankChaseWeek,
  shouldShowWeeklyChase,
  type ChaseHit,
  type ChasePayload,
} from "@/lib/chase";
import { confidenceFor, recencyFactor, scoreHoney, type HoneyPlace } from "@/lib/honey";

const NOW = new Date("2026-10-20T18:00:00.000Z");

function hit(partial: Partial<ChaseHit> & Pick<ChaseHit, "lat" | "lon" | "stormDate">): ChaseHit {
  return {
    lat: partial.lat,
    lon: partial.lon,
    stormDate: partial.stormDate,
    occurredAt: partial.occurredAt ?? `${partial.stormDate}T22:00:00.000Z`,
    location: partial.location ?? null,
    county: partial.county ?? null,
    state: partial.state ?? null,
    spotterIn: partial.spotterIn ?? null,
    radarIn: partial.radarIn ?? null,
    confidence: partial.confidence ?? "spotter",
  };
}

function lot(partial: Partial<HoneyPlace> & Pick<HoneyPlace, "lat" | "lon" | "vehicles" | "homes">): HoneyPlace {
  return {
    id: partial.id ?? `lot-${partial.lat}-${partial.lon}`,
    kind: partial.kind ?? "dealership",
    name: partial.name ?? "Dealer row",
    city: partial.city ?? null,
    neighborhood: partial.neighborhood ?? null,
    lat: partial.lat,
    lon: partial.lon,
    vehicles: partial.vehicles,
    homes: partial.homes,
    vehicleBasis: partial.vehicleBasis ?? "area",
  };
}

describe("weekly chase week key", () => {
  it("uses an ISO week key that stays stable through the week", () => {
    expect(isoWeekKey(new Date("2020-12-31T12:00:00.000Z"))).toBe("2020-W53");
    expect(isoWeekKey(new Date("2021-01-01T00:00:00.000Z"))).toBe("2020-W53");
    expect(isoWeekKey(new Date("2021-01-04T12:00:00.000Z"))).toBe("2021-W01");
    expect(isoWeekKey(NOW)).toBe("2026-W43");
    expect(chasePopupKey("2026-W43")).toBe("hailmap-chase-popup:2026-W43");
    expect(chaseViewedKey("2026-W43")).toBe("hailmap-chase-viewed:2026-W43");
  });

  it("shows the popup once per week and the new dot until the list is viewed", () => {
    expect(shouldShowWeeklyChase(null)).toBe(true);
    expect(shouldShowWeeklyChase("1")).toBe(false);
    expect(chaseListIsNew(null)).toBe(true);
    expect(chaseListIsNew("1")).toBe(false);
  });
});

describe("money hole chase ranking", () => {
  const wichita = hit({
    lat: 37.69,
    lon: -97.34,
    stormDate: "2026-10-20",
    occurredAt: "2026-10-20T23:00:00.000Z",
    location: "Wichita",
    state: "KS",
    spotterIn: 2,
    radarIn: 1.75,
    confidence: "spotter",
  });
  const dallas = hit({
    lat: 32.78,
    lon: -96.8,
    stormDate: "2026-10-18",
    occurredAt: "2026-10-18T22:00:00.000Z",
    location: "Dallas",
    state: "TX",
    spotterIn: null,
    radarIn: 1.1,
    confidence: "mesh",
  });
  const places = [
    lot({ lat: 37.69, lon: -97.34, vehicles: 500, homes: 80, city: "Wichita" }),
    lot({ lat: 37.7, lon: -97.33, vehicles: 300, homes: 20, city: "Wichita" }),
    lot({ lat: 32.78, lon: -96.8, vehicles: 4000, homes: 40, city: "Dallas" }),
  ];

  it("clusters a metro and keeps distant cities apart", () => {
    const moore = hit({
      lat: 35.34,
      lon: -97.49,
      stormDate: "2026-10-20",
      location: "Moore",
      state: "OK",
      spotterIn: 1.25,
      radarIn: 1,
    });
    const norman = hit({
      lat: 35.22,
      lon: -97.44,
      stormDate: "2026-10-20",
      location: "Norman",
      state: "OK",
      spotterIn: 1.75,
      radarIn: 1.5,
    });
    const clusters = clusterChaseHits([moore, norman, dallas]);
    expect(clusters).toHaveLength(2);
    const oklahoma = clusters.find((cluster) => cluster.hits.length === 2);
    expect(oklahoma?.name).toBe("Norman, OK");
    expect(oklahoma?.hits).toHaveLength(2);
  });

  it("ranks this week's areas by the Money Hole score and keeps radar and spotter hail", () => {
    const payload = rankChaseWeek({ hits: [dallas, wichita], places, now: NOW });
    expect(payload.week).toBe("2026-W43");
    expect(payload.quiet).toBe(false);
    expect(payload.windowStart).toBe("2026-10-14");
    expect(payload.windowEnd).toBe("2026-10-20");
    expect(payload.fresh.pdr.map((stop) => stop.name)).toEqual(["Wichita, KS", "Dallas, TX"]);
    const top = payload.fresh.pdr[0];
    const agreed = confidenceFor({
      meshIn: 1.75,
      report: { lat: 37.69, lon: -97.34, sizeIn: 2, occurredAt: wichita.occurredAt, confidence: "spotter", location: "Wichita" },
    });
    const latest = Date.parse("2026-10-20T23:00:00.000Z");
    const recency = recencyFactor(wichita.occurredAt, latest, false, NOW.getTime());
    const expected = scoreHoney({
      mode: "pdr",
      hailIn: agreed.hailIn,
      count: 800,
      recency,
      confidence: agreed.factor,
    });
    expect(top.score).toBe(expected.score);
    expect(top.raw).toBe(Math.round(expected.raw * 1000) / 1000);
    expect(top.level).toBe(expected.level);
    expect(top.date).toBe("2026-10-20");
    expect(top.radarIn).toBe(1.75);
    expect(top.spotterIn).toBe(2);
    expect(top.vehicles).toBe(800);
    expect(top.homes).toBe(100);
    expect(payload.fresh.pdr[1].radarIn).toBe(1.1);
    expect(payload.fresh.pdr[1].spotterIn).toBeNull();
    expect(payload.fallback.pdr).toHaveLength(0);
  });

  it("switches the count and the order between PDR and roofing", () => {
    const homes = hit({
      lat: 39.1,
      lon: -94.58,
      stormDate: "2026-10-19",
      occurredAt: "2026-10-19T23:30:00.000Z",
      location: "Kansas City",
      state: "MO",
      spotterIn: 1.75,
      radarIn: 1.75,
      confidence: "nws",
    });
    const dealer = hit({
      lat: 35.47,
      lon: -97.52,
      stormDate: "2026-10-19",
      occurredAt: "2026-10-19T23:30:00.000Z",
      location: "Oklahoma City",
      state: "OK",
      spotterIn: 1.75,
      radarIn: 1.75,
      confidence: "nws",
    });
    const payload = rankChaseWeek({
      hits: [homes, dealer],
      places: [
        lot({ id: "kc", lat: 39.1, lon: -94.58, vehicles: 40, homes: 4200, kind: "homes" }),
        lot({ id: "okc", lat: 35.47, lon: -97.52, vehicles: 1800, homes: 30, kind: "dealership" }),
      ],
      now: NOW,
    });
    expect(payload.fresh.pdr[0].name).toBe("Oklahoma City, OK");
    expect(payload.fresh.pdr[0].vehicles).toBe(1800);
    expect(payload.fresh.roof[0].name).toBe("Kansas City, MO");
    expect(payload.fresh.roof[0].homes).toBe(4200);
  });

  it("keeps one row per area on the stronger storm day", () => {
    const earlier = hit({
      lat: 37.69,
      lon: -97.34,
      stormDate: "2026-10-15",
      occurredAt: "2026-10-15T21:00:00.000Z",
      location: "Wichita",
      state: "KS",
      spotterIn: 1,
      radarIn: 1,
    });
    const payload = rankChaseWeek({
      hits: [earlier, wichita],
      places: [lot({ lat: 37.69, lon: -97.34, vehicles: 500, homes: 80 })],
      now: NOW,
    });
    expect(payload.fresh.pdr).toHaveLength(1);
    expect(payload.fresh.pdr[0].date).toBe("2026-10-20");
    expect(payload.fresh.pdr[0].spotterIn).toBe(2);
  });

  it("treats a quiet week as empty and falls back to recent major storms", () => {
    const pea = hit({
      lat: 35.22,
      lon: -97.44,
      stormDate: "2026-10-19",
      location: "Norman",
      state: "OK",
      spotterIn: 0.88,
      radarIn: 0.75,
    });
    const major = hit({
      lat: 33.45,
      lon: -112.07,
      stormDate: "2026-09-28",
      occurredAt: "2026-09-28T23:00:00.000Z",
      location: "Phoenix",
      state: "AZ",
      spotterIn: 2.5,
      radarIn: 2.25,
      confidence: "nws",
    });
    const olderPea = hit({
      lat: 39.74,
      lon: -104.99,
      stormDate: "2026-09-02",
      location: "Denver",
      state: "CO",
      spotterIn: 0.75,
      radarIn: 0.75,
    });
    const payload = rankChaseWeek({
      hits: [pea, major, olderPea],
      places: [
        lot({ lat: 35.22, lon: -97.44, vehicles: 200, homes: 100 }),
        lot({ lat: 33.45, lon: -112.07, vehicles: 900, homes: 1200 }),
        lot({ lat: 39.74, lon: -104.99, vehicles: 100, homes: 100 }),
      ],
      now: NOW,
    });
    expect(payload.quiet).toBe(true);
    expect(payload.fresh.pdr).toHaveLength(0);
    expect(payload.fresh.roof).toHaveLength(0);
    expect(payload.fallback.pdr.map((stop) => stop.name)).toEqual(["Phoenix, AZ"]);
    expect(payload.fallback.pdr[0].date).toBe("2026-09-28");
    expect(payload.fallback.pdr[0].spotterIn).toBe(2.5);
    expect(payload.fallback.pdr[0].radarIn).toBe(2.25);
    expect(payload.fallback.pdr[0].score).toBeGreaterThan(0);
  });
});

describe("chase cache", () => {
  const previous = process.env.HAILMAP_DATA_DIR;
  let dir = "";

  afterEach(() => {
    if (previous == null) delete process.env.HAILMAP_DATA_DIR;
    else process.env.HAILMAP_DATA_DIR = previous;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("reads a warm weekly file and ignores another week", () => {
    dir = mkdtempSync(path.join(tmpdir(), "hailmap-chase-"));
    process.env.HAILMAP_DATA_DIR = dir;
    const payload = rankChaseWeek({ hits: [], places: [], now: NOW });
    writeChaseCache(payload);
    expect(readChaseCache()?.week).toBe("2026-W43");
    expect(cachedChase(NOW)?.week).toBe("2026-W43");
    expect(cachedChase(new Date("2026-10-27T18:00:00.000Z"))).toBeNull();
  });
});

function samplePayload(quiet: boolean): ChasePayload {
  const base = rankChaseWeek({ hits: [], places: [], now: NOW });
  const stop = {
    id: "wichita:2026-10-20",
    name: "Wichita, KS",
    date: "2026-10-20",
    lat: 37.69,
    lon: -97.34,
    bounds: { west: -97.6, south: 37.4, east: -97.1, north: 37.9 },
    radarIn: 1.75,
    spotterIn: 2,
    vehicles: 800,
    homes: 100,
    score: 86,
    raw: 4.2,
    level: "Very High" as const,
    source: "agreed" as const,
    sourceLabel: "Radar and spotter agree",
    density: "measured" as const,
  };
  if (quiet) return { ...base, quiet: true, fresh: { pdr: [], roof: [] }, fallback: { pdr: [stop], roof: [stop] } };
  return { ...base, quiet: false, fresh: { pdr: [stop], roof: [{ ...stop, homes: 100 }] }, fallback: { pdr: [], roof: [] } };
}

describe("chase list UI", () => {
  it("renders a phone sheet with a close control, five-row preview, and see all", () => {
    const stops = Array.from({ length: 6 }, (_, index) => ({
      ...samplePayload(false).fresh.pdr[0],
      id: `area-${index}`,
      name: `City ${index + 1}, TX`,
      score: 90 - index,
    }));
    const payload: ChasePayload = {
      ...samplePayload(false),
      fresh: { pdr: stops, roof: stops },
    };
    const html = renderToStaticMarkup(
      createElement(ChasePopup, {
        mobile: true,
        mode: "pdr",
        payload,
        preview: true,
        onMode: () => undefined,
        onClose: () => undefined,
        onSeeAll: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('data-chase-popup');
    expect(html).toContain('data-bottom-sheet');
    expect(html).toContain('data-sheet-grab');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("This week&#x27;s chase list");
    expect(html).toContain("Money Hole");
    expect(html.match(/data-chase-stop/g)).toHaveLength(CHASE_PREVIEW);
    expect(html).toContain('data-chase-see-all');
    expect(html).toContain("City 1, TX");
    expect(html).not.toContain("City 6, TX");
    expect(html).toContain("Radar 1.75");
    expect(html).toContain("Spotter 2.00");
    expect(html).toContain("800 vehicles");
    expect(html).toContain(">86<");
  });

  it("renders the quiet empty state and recent major storms", () => {
    const html = renderToStaticMarkup(
      createElement(ChaseSection, {
        mode: "roof",
        payload: samplePayload(true),
        preview: false,
        onMode: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('data-chase-empty');
    expect(html).toContain("Quiet week");
    expect(html).toContain("No fresh Money Holes");
    expect(html).toContain("Recent major storms");
    expect(html).toContain("100 homes");
    expect(html).toContain("Wichita, KS");
  });

  it("does not let the chase sheet pull to refresh", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.chase-body\s*\{[^}]*overscroll-behavior:\s*contain/);
  });
});
