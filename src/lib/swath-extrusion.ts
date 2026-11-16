import { MESH_LEGEND } from "@/lib/mesh-legend";

/**
 * Meters of extrusion at {@link SWATH_HEIGHT_ZOOM}. A low slab: 2.5" hail is
 * clearly taller than the green edge, but the steps between sizes are small
 * enough to read as one ridge.
 */
export function swathExtrusionMeters(inches: number): number {
  const size = Number.isFinite(inches) ? Math.min(6, Math.max(0, inches)) : 0;
  const t = Math.min(1, Math.max(0, (size - 0.5) / 2.2));
  return Math.round(5200 + 4600 * t ** 0.75);
}

/** Zoom the reviewed screenshots used. Other zooms scale from here. */
export const SWATH_HEIGHT_ZOOM = 7.4;

/** Halve the real-world height for each zoom level in, so the slab stays a similar size on screen. */
export function swathZoomScale(zoom: number): number {
  return 2 ** (SWATH_HEIGHT_ZOOM - zoom);
}

export function swathExtrusionMetersAtZoom(inches: number, zoom: number): number {
  return swathExtrusionMeters(inches) * swathZoomScale(zoom);
}

const HEIGHT_STOPS = [0, 0.75, 1, 1.5, 2, 2.5, 4] as const;

function sizeHeight(scale: number): unknown[] {
  const size = ["to-number", ["coalesce", ["get", "minIn"], ["get", "maxSizeIn"], ["get", "maxIn"], 0]];
  const expression: unknown[] = ["interpolate", ["linear"], size];
  for (const stop of HEIGHT_STOPS) expression.push(stop, Math.round(swathExtrusionMeters(stop) * scale));
  return expression;
}

/**
 * Top-level zoom interpolate, with the hail-size curve at each stop.
 * MapLibre fades between the two nearest zoom stops on the GPU, so the slab
 * does not jump as you scroll in.
 */
export function swathExtrusionHeight(): unknown[] {
  const expression: unknown[] = ["interpolate", ["linear"], ["zoom"]];
  for (let zoom = 3; zoom <= 16; zoom += 1) expression.push(zoom, sizeHeight(swathZoomScale(zoom)));
  return expression;
}

/** Same colors as the flat swath and the hail-size legend. */
export const swathExtrusionColor = ["coalesce", ["get", "color"], "#64748b"] as const;

/** Side walls. About half transparent so the base map and towns show through. */
export const SWATH_EXTRUSION_OPACITY = 0.5;

/** First frame of a rise, before the bloom. Still clearly the hail color. */
export const SWATH_EXTRUSION_OPACITY_START = 0.24;

/** A gentle tilt. Enough to see the slab, not enough to turn it into a wall. */
export const SWATH_3D_PITCH = 30;

/** A small turn so the lit edge of a slab shows, while town names stay easy to read. */
export const SWATH_BEARING_OFFSET = -8;

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
  targetPitch = SWATH_3D_PITCH,
): { pitch: number; bearing: number } {
  if (!depth) return { pitch: 0, bearing: 0 };
  const cinematic = pose ? pose.bearing + pose.offset : current.bearing;
  const drifted = pose != null && Math.abs(angleDelta(current.bearing, cinematic)) > 8;
  const pitch = Math.max(current.pitch, targetPitch);
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
 * Azimuth is clockwise from the top of the screen. Polar 0 is overhead, so a
 * lower polar angle lights the top of each slab and leaves the sides softer.
 */
export const SWATH_LIGHT = {
  anchor: "viewport" as const,
  color: "#fff8ef",
  intensity: 0.72,
  position: [1.2, 140, 42] as [number, number, number],
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
