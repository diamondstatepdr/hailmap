/**
 * Hail-path geometry is built from one fixed box around a snapped map center.
 * Zooming changes how much of that box is on screen. It does not change the box,
 * so the same reports — and the same polygon — stay on the same ground.
 */

export const SWATH_WINDOW_DEG = 5;
/** Centers this close still belong to the swath already on the map. */
export const SWATH_ANCHOR_MOVE_DEG = 0.45;
/** Snap so a small camera shift from chrome or zoom does not pick a new box. */
export const SWATH_SNAP_DEG = 0.5;

export interface SwathViewBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function swathViewCenter(bounds: SwathViewBounds): { lat: number; lon: number } {
  return {
    lat: (bounds.south + bounds.north) / 2,
    lon: (bounds.west + bounds.east) / 2,
  };
}

export function snapSwathCenter(center: { lat: number; lon: number }, snap = SWATH_SNAP_DEG): { lat: number; lon: number } {
  const grid = (value: number) => Math.round(value / snap) * snap;
  return {
    lat: Math.round(grid(center.lat) * 1e6) / 1e6,
    lon: Math.round(grid(center.lon) * 1e6) / 1e6,
  };
}

/** Fixed geographic window. The view's width is ignored on purpose. */
export function swathQueryBounds(center: { lat: number; lon: number }, spanDeg = SWATH_WINDOW_DEG): SwathViewBounds {
  const half = spanDeg / 2;
  const lat = Math.min(85, Math.max(-85, center.lat));
  const south = Math.max(-85, lat - half);
  const north = Math.min(85, lat + half);
  return {
    west: center.lon - half,
    east: center.lon + half,
    south,
    north,
  };
}

export function swathBoundsForView(view: SwathViewBounds): SwathViewBounds {
  return swathQueryBounds(snapSwathCenter(swathViewCenter(view)));
}

export function viewSpanDeg(bounds: SwathViewBounds): number {
  return Math.max(bounds.east - bounds.west, bounds.north - bounds.south);
}

/** True when the camera has moved far enough that a new swath box is needed. */
export function shouldRetargetSwath(
  anchor: { lat: number; lon: number } | null,
  view: SwathViewBounds,
  moveDeg = SWATH_ANCHOR_MOVE_DEG,
): boolean {
  if (!anchor) return true;
  const center = swathViewCenter(view);
  return Math.abs(center.lat - anchor.lat) > moveDeg || Math.abs(center.lon - anchor.lon) > moveDeg;
}
