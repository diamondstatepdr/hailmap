import { MESH_LEGEND } from "@/lib/mesh-legend";

/**
 * Meters of extrusion for a hail size in inches. The curve is steeper than a
 * straight line so 2" stands clearly above 1" at a city zoom, without a lip so
 * tall that a street zoom becomes a wall.
 *
 * Height is baked into the extrusion once. Animating it every frame would
 * rebuild those polygons on the worker. The rise the eye sees is the camera
 * tilt plus the opacity bloom, which stay on the GPU.
 */
export function swathExtrusionMeters(inches: number): number {
  const size = Number.isFinite(inches) ? Math.min(6, Math.max(0, inches)) : 0;
  // About 20px for sub-inch hail and about 90px for 4" hail at a city zoom,
  // so the volume reads without covering the towns around it.
  return Math.round(5000 + size ** 1.4 * 16000);
}

const HEIGHT_STOPS = [0, 0.75, 1, 1.5, 2, 2.5, 4] as const;

/** MapLibre expression. Uses the feature's max hail size, then the band minimum. */
export function swathExtrusionHeight(): unknown[] {
  const size = ["to-number", ["coalesce", ["get", "maxSizeIn"], ["get", "maxIn"], ["get", "minIn"], 0]];
  const expression: unknown[] = ["interpolate", ["linear"], size];
  for (const stop of HEIGHT_STOPS) expression.push(stop, swathExtrusionMeters(stop));
  return expression;
}

/** Same colors as the flat swath and the hail-size legend. */
export const swathExtrusionColor = ["coalesce", ["get", "color"], "#64748b"] as const;

/** Settled volume. Low enough that towns stay readable through the walls. */
export const SWATH_EXTRUSION_OPACITY = 0.5;

/** First frame of a rise, before the bloom. Still clearly the hail color. */
export const SWATH_EXTRUSION_OPACITY_START = 0.24;

export const SWATH_3D_PITCH = 48;

/** A small turn so the lit side of a swath is visible, not just the top. */
export const SWATH_BEARING_OFFSET = -16;

/** Shared timing for the tilt, the light, and the opacity bloom. */
export const SWATH_MOVE_MS = 1100;

export const SWATH_MAX_PITCH = 60;

/**
 * Phones stay flat until someone asks for 3D. A tilted vector basemap plus
 * extruded radar is a poor default on a small GPU. Desktop starts in 3D.
 */
export function defaultSwathExtrusion(width: number): boolean {
  return width >= 768;
}

export function tiltEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 4;
}

export function angleDelta(a: number, b: number): number {
  const turn = (a - b) % 360;
  if (turn > 180) return turn - 360;
  if (turn < -180) return turn + 360;
  return turn;
}

export interface DepthPose {
  bearing: number;
  offset: number;
}

/**
 * Pitch and bearing for a programmatic camera move. Flat mode is north-up.
 * In 3D, keep a manual tilt above the default and keep a bearing the person
 * has turned away from the cinematic angle.
 */
export function depthFrame(
  depth: boolean,
  pose: DepthPose | null,
  current: { pitch: number; bearing: number },
): { pitch: number; bearing: number } {
  if (!depth) return { pitch: 0, bearing: 0 };
  const cinematic = pose ? pose.bearing + pose.offset : current.bearing;
  const drifted = pose != null && Math.abs(angleDelta(current.bearing, cinematic)) > 8;
  const pitch = current.pitch > SWATH_3D_PITCH ? current.pitch : SWATH_3D_PITCH;
  return { pitch, bearing: drifted ? current.bearing : cinematic };
}

const EXTRUDABLE_FILLS = new Set(["swath-fill", "mesh-fill", "mesh-a-fill", "mesh-b-fill"]);

/** Hit-test the volume while it is showing, and the flat fill otherwise. */
export function swathHitLayer(id: string, volume: boolean): string {
  if (!volume || !EXTRUDABLE_FILLS.has(id)) return id;
  return id.replace(/-fill$/, "-extrusion");
}

/**
 * Viewport light, slightly warm, low enough that the legend colors stay true
 * and high enough that the sides of a swath read as shaded.
 * Azimuth is clockwise from the top of the screen. Polar 0 is overhead.
 */
export const SWATH_LIGHT = {
  anchor: "viewport" as const,
  color: "#fff4e6",
  intensity: 0.62,
  position: [1.35, 132, 58] as [number, number, number],
};

/** MapLibre's own light, restored when the map goes flat. */
export const SWATH_FLAT_LIGHT = {
  anchor: "viewport" as const,
  color: "#ffffff",
  intensity: 0.5,
  position: [1.15, 210, 30] as [number, number, number],
};

export function swathHeightLegend(): Array<{ label: string; color: string; percent: number }> {
  const rows = MESH_LEGEND.map((band) => ({
    label: band.mapLabel,
    color: band.color,
    meters: swathExtrusionMeters(band.minIn),
  }));
  const peak = rows[rows.length - 1]?.meters ?? 1;
  return rows.map((row) => ({
    label: row.label,
    color: row.color,
    percent: Math.round((row.meters / peak) * 100),
  }));
}
