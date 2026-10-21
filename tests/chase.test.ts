import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import ChaseMapButton from "@/components/chase/ChaseMapButton";
import ChasePopup from "@/components/chase/ChasePopup";
import { ChaseSection } from "@/components/chase/ChaseList";
import { placeChaseHit, townFromLocation } from "@/lib/chase-place";
import { nearestTownName, townFromCensusGeographies } from "@/lib/chase-town";
import { cachedChase, readChaseCache, writeChaseCache } from "@/lib/chase-cache";
import { frameInsideUnitedStates } from "@/lib/map-home";
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

  it("leaves out an area until its vehicle or home count is known", () => {
    const rural = hit({
      lat: 30.1,
      lon: -102.5,
      stormDate: "2026-10-14",
      county: "Terrell",
      state: "TX",
      spotterIn: null,
      radarIn: 3.47,
      confidence: "mesh",
    });
    const payload = rankChaseWeek({ hits: [rural, wichita], places, now: NOW });
    expect(payload.fresh.pdr.map((stop) => stop.name)).toEqual(["Wichita, KS"]);
    expect(payload.fresh.pdr[0].vehicles).toBe(800);
    expect(payload.fresh.pdr[0].density).toBe("measured");
    expect(payload.version).toBe(3);
  });

  it("ranks an unconfirmed radar outlier below a confirmed town with more vehicles", () => {
    const lisbon = hit({
      lat: 44.7,
      lon: -75.2,
      stormDate: "2026-10-16",
      occurredAt: "2026-10-16T22:00:00.000Z",
      location: "Lisbon",
      state: "NY",
      spotterIn: null,
      radarIn: 4.73,
      confidence: "mesh",
    });
    const crowell = hit({
      lat: 33.93,
      lon: -99.75,
      stormDate: "2026-10-14",
      occurredAt: "2026-10-14T22:00:00.000Z",
      location: "Crowell",
      state: "TX",
      spotterIn: 1.75,
      radarIn: 2.42,
      confidence: "spotter",
    });
    const payload = rankChaseWeek({
      hits: [lisbon, crowell],
      places: [
        lot({ lat: 44.7, lon: -75.2, vehicles: 8, homes: 40 }),
        lot({ lat: 33.93, lon: -99.75, vehicles: 400, homes: 80 }),
      ],
      now: NOW,
    });
    expect(payload.fresh.pdr.map((stop) => stop.name)).toEqual(["Crowell, TX", "Lisbon, NY"]);
    const radar = payload.fresh.pdr[1];
    expect(radar.source).toBe("mesh");
    expect(radar.sourceLabel).toBe("Radar only");
    expect(radar.vehicles).toBe(8);
    expect(radar.spotterIn).toBeNull();
  });

  it("does not count a lot in the next radar cell as vehicles under an unconfirmed spike", () => {
    const spike = hit({
      lat: 44.7,
      lon: -75.2,
      stormDate: "2026-10-16",
      location: "Lisbon",
      state: "NY",
      spotterIn: null,
      radarIn: 4.73,
      confidence: "mesh",
    });
    const confirmed = hit({
      lat: 32.26,
      lon: -107.76,
      stormDate: "2026-10-19",
      location: "Deming",
      state: "NM",
      spotterIn: 1.25,
      radarIn: 2.24,
      confidence: "spotter",
    });
    const payload = rankChaseWeek({
      hits: [spike, confirmed],
      places: [
        lot({ lat: 44.746, lon: -75.1305, vehicles: 135, homes: 0, kind: "parking" }),
        lot({ lat: 32.26, lon: -107.76, vehicles: 2000, homes: 700, kind: "dealership" }),
      ],
      now: NOW,
    });
    expect(payload.fresh.pdr.map((stop) => stop.name)).toEqual(["Deming, NM"]);
    expect(payload.fresh.pdr[0].vehicles).toBe(2000);
    expect(payload.fresh.pdr[0].source).not.toBe("mesh");
  });
});

describe("real chase places", () => {
  it("names a radar cell by its US county and drops hail outside the country", () => {
    const texas = placeChaseHit(hit({ lat: 30.2, lon: -102.5, stormDate: "2026-10-14", radarIn: 3.47, confidence: "mesh", spotterIn: null }));
    expect(texas?.state).toBe("TX");
    expect(texas?.county).toBe("Terrell");
    expect(texas?.location).toBeNull();
    const canada = placeChaseHit(hit({ lat: 52.2, lon: -102.6, stormDate: "2026-10-15", radarIn: 2.31, confidence: "mesh", spotterIn: null }));
    expect(canada).toBeNull();
    const named = placeChaseHit(hit({ lat: 33.93, lon: -99.75, stormDate: "2026-10-14", location: "4 SW Crowell", state: "TX", spotterIn: 1.75, radarIn: 2.42 }));
    expect(named?.location).toBe("Crowell");
    expect(named?.state).toBe("TX");
    const zone = placeChaseHit(hit({ lat: 32.02, lon: -108.59, stormDate: "2026-10-20", location: "Grant, NM; Hidalgo, NM", spotterIn: 1, radarIn: null }));
    expect(zone?.location).toBeNull();
    expect(zone?.state).toBe("NM");
    expect(zone?.county).toBeTruthy();
    expect(townFromLocation("1 W Deming")).toBe("Deming");
    expect(townFromLocation("18 N Pirtleville")).toBe("Pirtleville");
    expect(townFromLocation("Town of Lisbon")).toBe("Lisbon");
    expect(townFromLocation("Hermon, St. Lawrence, NY")).toBe("Hermon");
    expect(townFromLocation("Grant, NM; Hidalgo, NM")).toBeNull();
    expect(townFromCensusGeographies({
      result: {
        geographies: {
          "County Subdivisions": [{ NAME: "Deming South CCD", BASENAME: "Deming South", LSADC: "22" }],
          "Incorporated Places": [{ NAME: "Deming city", BASENAME: "Deming", LSADC: "25" }],
        },
      },
    })).toBe("Deming");
    expect(townFromCensusGeographies({
      result: { geographies: { "County Subdivisions": [{ NAME: "West Terrell CCD", BASENAME: "West Terrell", LSADC: "22" }] } },
    })).toBeNull();
    expect(townFromCensusGeographies({
      result: { geographies: { "County Subdivisions": [{ NAME: "Lisbon town", BASENAME: "Lisbon", LSADC: "43" }] } },
    })).toBe("Lisbon");
    expect(townFromCensusGeographies({
      result: { geographies: { "County Subdivisions": [{ NAME: "Crowell CCD", BASENAME: "Crowell", LSADC: "22" }] } },
    })).toBe("Crowell");
    expect(nearestTownName(
      [
        { lat: 30.14, lon: -102.4, tags: { place: "city", name: "Sanderson" } },
        { lat: 30.9, lon: -101.4, tags: { place: "town", name: "Ozona" } },
      ],
      30.1,
      -102.5,
    )).toBe("Sanderson");
  });

  it("keeps the national map frame inside the United States", () => {
    expect(frameInsideUnitedStates({ west: -123, south: 22, east: -60, north: 53.6 })).toEqual({
      west: -123,
      south: 24.2,
      east: -66.5,
      north: 49.4,
    });
    expect(frameInsideUnitedStates({ west: -110, south: 52, east: -90, north: 60 }).south).toBeLessThan(50);
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

describe("chase map button", () => {
  it("labels the control and shows the new dot until the week is viewed", () => {
    const fresh = renderToStaticMarkup(createElement(ChaseMapButton, { unseen: true, expanded: false, onClick: () => undefined }));
    expect(fresh).toContain("Chase list");
    expect(fresh).toContain('data-chase-open');
    expect(fresh).toContain('data-chase-new');
    expect(fresh).toContain("New chase list");
    const seen = renderToStaticMarkup(createElement(ChaseMapButton, { unseen: false, expanded: true, onClick: () => undefined }));
    expect(seen).toContain("Chase list");
    expect(seen).not.toContain('data-chase-new');
    expect(seen).toContain('aria-expanded="true"');
  });
});

describe("chase list UI", () => {
  it("renders a phone sheet with a close control, five-row preview, and see all", () => {
    const stops = Array.from({ length: 6 }, (_, index) => ({
      ...samplePayload(false).fresh.pdr[0],
      id: `area-${index}`,
      name: `City ${index + 1}, TX`,
      score: 90 - index,
    }));
    stops[4] = { ...stops[4], spotterIn: null, radarIn: 4.73, source: "mesh", sourceLabel: "Radar only", name: "Lisbon, NY" };
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
    expect(html).toContain("Radar size 1.75&quot;");
    expect(html).toContain("Spotter size 2.00&quot;");
    expect(html).toContain("No spotter report");
    expect(html).toContain("Radar size only");
    expect(html).toContain("Lisbon, NY");
    expect(html).not.toContain("loading");
    expect(html).toContain("800 vehicles");
    expect(html).toContain(">86<");
  });

  it("renders each stop's own hail size, vehicle count, and date", () => {
    const base = samplePayload(false).fresh.pdr[0];
    const payload: ChasePayload = {
      ...samplePayload(false),
      fresh: {
        pdr: [
          { ...base, id: "mesa", name: "Mesa, AZ", date: "2026-10-20", radarIn: null, spotterIn: 2, vehicles: 233409, score: 78 },
          { ...base, id: "deming", name: "Deming, NM", date: "2026-10-19", radarIn: 2.24, spotterIn: 1.25, vehicles: 3912, score: 75 },
        ],
        roof: [],
      },
    };
    const html = renderToStaticMarkup(
      createElement(ChaseSection, {
        mode: "pdr",
        payload,
        preview: false,
        onMode: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain("Mesa, AZ");
    expect(html).toContain("Deming, NM");
    expect(html).toContain("Oct 20, 2026");
    expect(html).toContain("Oct 19, 2026");
    expect(html).toContain("Radar size —");
    expect(html).toContain("Spotter size 2.00&quot;");
    expect(html).toContain("233,409 vehicles in the hail path");
    expect(html).toContain("Radar size 2.24&quot;");
    expect(html).toContain("Spotter size 1.25&quot;");
    expect(html).toContain("3,912 vehicles in the hail path");
    expect(html.match(/data-chase-stop/g)).toHaveLength(2);
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
    expect(html).toContain("No hail here this week");
    expect(html).toContain("Recent major storms");
    expect(html).toContain("100 homes");
    expect(html).toContain("Wichita, KS");
  });

  it("does not let the chase sheet pull to refresh", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.chase-body\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.chase-sheet-dock\s*\{[^}]*var\(--chrome-offset\)/);
  });
});
