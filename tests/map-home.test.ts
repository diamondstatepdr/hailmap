import { describe, expect, it } from "vitest";
import { CHASE_MAP_GAP_PX, chaseMapPadding, DEFAULT_HOME_VIEW, homeViewAfterChase } from "@/lib/map-home";

describe("chase map padding", () => {
  it("fills the phone gap above the sheet instead of shrinking the country", () => {
    const mapHeight = 830;
    const chromePx = 148;
    const pad = chaseMapPadding({ mobile: true, chromePx, mapHeight, sheet: true });
    const band = mapHeight - pad.top - pad.bottom;
    expect(pad.top).toBe(chromePx);
    expect(band).toBe(CHASE_MAP_GAP_PX + 8);
    expect(band).toBeGreaterThan(200);
  });

  it("shrinks the country when the window is taller than the map", () => {
    const chromePx = 196;
    const mapHeight = 854;
    const fitted = chaseMapPadding({ mobile: true, chromePx, mapHeight, sheet: true });
    const guessed = chaseMapPadding({ mobile: true, chromePx, mapHeight: 915, sheet: true });
    const band = (height: number, pad: { top: number; bottom: number }) => height - pad.top - pad.bottom;
    expect(band(mapHeight, fitted)).toBe(CHASE_MAP_GAP_PX + 8);
    expect(band(mapHeight, guessed)).toBeLessThan(180);
  });
});

describe("home view after the chase sheet", () => {
  it("keeps a saved city and replaces a hemisphere zoom with the default US view", () => {
    expect(homeViewAfterChase({ lat: 32.75, lon: -97.33, zoom: 11 })).toEqual({ lat: 32.75, lon: -97.33, zoom: 11 });
    expect(homeViewAfterChase(null)).toEqual(DEFAULT_HOME_VIEW);
    expect(homeViewAfterChase({ lat: 15, lon: -90, zoom: 1.7 })).toEqual(DEFAULT_HOME_VIEW);
    expect(DEFAULT_HOME_VIEW.zoom).toBeGreaterThanOrEqual(3.5);
    expect(DEFAULT_HOME_VIEW.zoom).toBeLessThanOrEqual(6);
  });
});
