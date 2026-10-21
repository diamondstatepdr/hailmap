import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChaseSection } from "@/components/chase/ChaseList";
import { chaseCacheStale } from "@/lib/chase-cache";
import { CHASE_REFRESH_MS } from "@/lib/chase-warm";
import {
  STORM_REFRESH_MS,
  chaseDotUnseen,
  chaseTopChanged,
  chaseTopIds,
  chaseTopKey,
  stormRefreshDue,
  updatedAgoLabel,
} from "@/lib/list-freshness";
import { readStormRefresh, writeStormRefresh, type StormRefreshStatus } from "@/lib/storm-refresh";
import type { ChasePayload, ChaseStop } from "@/lib/chase-week";

const NOW = new Date("2026-10-21T12:00:00.000Z");

function stop(id: string, score: number): ChaseStop {
  return {
    id,
    name: id,
    date: "2026-10-20",
    lat: 33,
    lon: -97,
    bounds: { west: -97.2, south: 32.8, east: -96.8, north: 33.2 },
    radarIn: 1.5,
    spotterIn: 1.25,
    vehicles: 10,
    homes: 10,
    score,
    raw: score,
    level: "High",
    source: "agreed",
    sourceLabel: "Radar and spotter agree",
    density: "measured",
  };
}

function week(ids: string[], generatedAt = "2026-10-21T06:00:00.000Z"): ChasePayload {
  const stops = ids.map((id, index) => stop(id, 90 - index));
  return {
    version: 3,
    week: "2026-W43",
    generatedAt,
    windowStart: "2026-10-15",
    windowEnd: "2026-10-21",
    quiet: false,
    partial: false,
    fresh: { pdr: stops, roof: stops },
    fallback: { pdr: [], roof: [] },
  };
}

describe("storm refresh schedule", () => {
  it("rebuilds from fresh hail every 6 hours", () => {
    expect(STORM_REFRESH_MS).toBe(6 * 60 * 60 * 1000);
    expect(CHASE_REFRESH_MS).toBe(STORM_REFRESH_MS);
    expect(stormRefreshDue(null, NOW)).toBe(true);
    expect(stormRefreshDue("not-a-date", NOW)).toBe(true);
    expect(stormRefreshDue(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe(false);
    const recent = new Date(NOW.getTime() - (6 * 60 * 60 * 1000 - 60_000)).toISOString();
    expect(stormRefreshDue(recent, NOW)).toBe(false);
    const due = new Date(NOW.getTime() - STORM_REFRESH_MS).toISOString();
    expect(stormRefreshDue(due, NOW)).toBe(true);
    expect(chaseCacheStale(week(["a"], due), NOW)).toBe(true);
    expect(chaseCacheStale(week(["a"], recent), NOW)).toBe(false);
  });

  const previous = process.env.HAILMAP_DATA_DIR;
  let dir = "";
  afterEach(() => {
    if (previous == null) delete process.env.HAILMAP_DATA_DIR;
    else process.env.HAILMAP_DATA_DIR = previous;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("records when the server last rebuilt rankings", () => {
    dir = mkdtempSync(path.join(tmpdir(), "hailmap-refresh-"));
    process.env.HAILMAP_DATA_DIR = dir;
    expect(readStormRefresh()).toBeNull();
    const status: StormRefreshStatus = {
      refreshedAt: "2026-10-21T06:00:00.000Z",
      topKey: "2026-W43|fresh|a|a",
      topChanged: false,
    };
    writeStormRefresh(status);
    expect(readStormRefresh()).toEqual(status);
  });
});

describe("chase top 5 change detection", () => {
  it("ignores a rebuild that keeps the same top 5", () => {
    const first = week(["a", "b", "c", "d", "e", "f"], "2026-10-21T00:00:00.000Z");
    const again = week(["a", "b", "c", "d", "e", "z"], "2026-10-21T06:00:00.000Z");
    again.fresh.pdr = again.fresh.pdr.map((item) => ({ ...item, score: item.score - 3 }));
    expect(chaseTopIds(first, "pdr")).toEqual(["a", "b", "c", "d", "e"]);
    expect(chaseTopChanged(first, again)).toBe(false);
    expect(chaseTopKey(first)).toBe(chaseTopKey(again));
  });

  it("notices a new storm in the top 5 and not a score-only refresh", () => {
    const first = week(["a", "b", "c", "d", "e"]);
    const reshuffled = week(["b", "a", "c", "d", "e"]);
    const replaced = week(["a", "b", "c", "d", "n"]);
    expect(chaseTopChanged(null, first)).toBe(true);
    expect(chaseTopChanged(first, reshuffled)).toBe(true);
    expect(chaseTopChanged(first, replaced)).toBe(true);
    expect(chaseDotUnseen(null, chaseTopKey(first))).toBe(true);
    expect(chaseDotUnseen("1", chaseTopKey(first))).toBe(false);
    expect(chaseDotUnseen(chaseTopKey(first), chaseTopKey(first))).toBe(false);
    expect(chaseDotUnseen(chaseTopKey(first), chaseTopKey(replaced))).toBe(true);
  });
});

describe("updated line", () => {
  it("says how many hours ago the lists were rebuilt", () => {
    expect(updatedAgoLabel(null, NOW)).toBeNull();
    expect(updatedAgoLabel(new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(), NOW)).toBe("Updated just now");
    expect(updatedAgoLabel(new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(), NOW)).toBe("Updated 1 h ago");
    expect(updatedAgoLabel(new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(), NOW)).toBe("Updated 2 h ago");
  });

  it("shows the line on the chase list", () => {
    const html = renderToStaticMarkup(
      createElement(ChaseSection, {
        mode: "pdr",
        payload: week(["Wichita, KS"]),
        preview: false,
        onMode: () => undefined,
        onSelect: () => undefined,
      }),
    );
    expect(html).toContain('data-updated');
    expect(html).toMatch(/Updated (just now|\d+ h ago)/);
  });
});
