import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MESH_LEGEND } from "@/lib/mesh-legend";
import {
  SWATH_3D_PITCH,
  SWATH_BEARING_OFFSET,
  SWATH_EXTRUSION_OPACITY,
  SWATH_EXTRUSION_OPACITY_START,
  SWATH_LIGHT,
  angleDelta,
  defaultSwathExtrusion,
  depthFrame,
  swathExtrusionColor,
  swathExtrusionHeight,
  swathExtrusionMeters,
  swathExtrusionMetersAtZoom,
  swathHeightLegend,
  swathHitLayer,
  tiltEase,
} from "@/lib/swath-extrusion";

describe("3D swath extrusion", () => {
  it("makes bigger hail taller, using the max size already on the polygon", () => {
    expect(swathExtrusionMeters(0.75)).toBeLessThan(swathExtrusionMeters(1));
    expect(swathExtrusionMeters(1)).toBeLessThan(swathExtrusionMeters(1.5));
    expect(swathExtrusionMeters(1.5)).toBeLessThan(swathExtrusionMeters(2));
    expect(swathExtrusionMeters(2)).toBeLessThan(swathExtrusionMeters(2.5));
    expect(swathExtrusionMeters(2.5)).toBeGreaterThan(swathExtrusionMeters(0.75) * 3);
    const reviewed = (inches: number) => {
      const size = Math.min(6, Math.max(0, inches));
      return 5000 + size ** 1.4 * 16000;
    };
    expect(swathExtrusionMeters(2.5)).toBeCloseTo(reviewed(2.5) / 5, -2);
    expect(swathExtrusionMeters(4)).toBeCloseTo(reviewed(4) / 5, -2);
    const height = JSON.stringify(swathExtrusionHeight());
    expect(height).toContain("maxSizeIn");
    expect(height).toContain("maxIn");
    expect(height).toContain("zoom");
    expect(JSON.stringify(swathExtrusionColor)).toContain("color");
  });

  it("keeps the slab about the same size on screen as the zoom changes", () => {
    const low = swathExtrusionMetersAtZoom(2.5, 6.4);
    const city = swathExtrusionMetersAtZoom(2.5, 7.4);
    const street = swathExtrusionMetersAtZoom(2.5, 9.4);
    expect(city).toBeCloseTo(swathExtrusionMeters(2.5), 5);
    expect(low / city).toBeCloseTo(2, 1);
    expect(city / street).toBeCloseTo(4, 1);
    const screen = (zoom: number) => swathExtrusionMetersAtZoom(2.5, zoom) * 2 ** zoom;
    expect(screen(6.4) / screen(9.4)).toBeCloseTo(1, 5);
  });

  it("keeps the walls see-through and blooms in from a fainter start", () => {
    expect(SWATH_EXTRUSION_OPACITY).toBeCloseTo(0.5, 2);
    expect(SWATH_EXTRUSION_OPACITY_START).toBeGreaterThan(0.15);
    expect(SWATH_EXTRUSION_OPACITY_START).toBeLessThan(SWATH_EXTRUSION_OPACITY);
  });

  it("uses a subtle tilt, with light on the top of each slab", () => {
    expect(SWATH_3D_PITCH).toBeGreaterThanOrEqual(26);
    expect(SWATH_3D_PITCH).toBeLessThanOrEqual(36);
    expect(SWATH_BEARING_OFFSET).toBeLessThan(0);
    expect(SWATH_BEARING_OFFSET).toBeGreaterThan(-30);
    expect(SWATH_LIGHT.anchor).toBe("viewport");
    expect(SWATH_LIGHT.intensity).toBeGreaterThan(0.4);
    expect(SWATH_LIGHT.intensity).toBeLessThan(0.8);
    expect(SWATH_LIGHT.position[2]).toBeGreaterThan(40);
    expect(tiltEase(0)).toBe(0);
    expect(tiltEase(1)).toBe(1);
    expect(tiltEase(0.5)).toBeGreaterThan(0.5);
  });

  it("starts flat on a phone and in 3D on a desktop", () => {
    expect(defaultSwathExtrusion(390)).toBe(false);
    expect(defaultSwathExtrusion(767)).toBe(false);
    expect(defaultSwathExtrusion(768)).toBe(true);
    expect(defaultSwathExtrusion(1280)).toBe(true);
  });

  it("keeps a manual bearing and resets a flat frame to north-up", () => {
    const pose = { bearing: 4, offset: SWATH_BEARING_OFFSET };
    expect(depthFrame(true, pose, { pitch: 10, bearing: pose.bearing + pose.offset })).toEqual({
      pitch: SWATH_3D_PITCH,
      bearing: pose.bearing + pose.offset,
    });
    expect(depthFrame(true, pose, { pitch: 61, bearing: 40 }).pitch).toBe(61);
    expect(depthFrame(true, pose, { pitch: 48, bearing: 40 }).bearing).toBe(40);
    expect(depthFrame(false, pose, { pitch: 48, bearing: -16 })).toEqual({ pitch: 0, bearing: 0 });
    expect(Math.abs(angleDelta(10, 350) - 20)).toBeLessThan(0.001);
  });

  it("hit-tests the volume only while it is showing", () => {
    expect(swathHitLayer("swath-fill", true)).toBe("swath-extrusion");
    expect(swathHitLayer("mesh-fill", true)).toBe("mesh-extrusion");
    expect(swathHitLayer("mesh-a-fill", true)).toBe("mesh-a-extrusion");
    expect(swathHitLayer("mesh-pulse-fill", true)).toBe("mesh-pulse-fill");
    expect(swathHitLayer("swath-fill", false)).toBe("swath-fill");
  });

  it("draws a height key in the same colors as the hail legend, taller for bigger hail", () => {
    const bars = swathHeightLegend();
    expect(bars.map((bar) => bar.color)).toEqual(MESH_LEGEND.map((band) => band.color));
    expect(bars.map((bar) => bar.label)).toEqual(MESH_LEGEND.map((band) => band.mapLabel));
    const percents = bars.map((bar) => bar.percent);
    expect(percents[percents.length - 1]).toBe(100);
    for (let i = 1; i < percents.length; i += 1) expect(percents[i]).toBeGreaterThan(percents[i - 1]);
  });

  it("does not simplify swath geometry, so the footprint stays put across zoom", () => {
    const source = readFileSync(new URL("../src/components/HailMap.tsx", import.meta.url), "utf8");
    expect(source).toContain("tolerance={0}");
    expect(source).toContain("buffer={512}");
    expect(source).toContain("fill-extrusion");
  });
});
