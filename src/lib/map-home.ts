import type { LngLatBounds } from "@/lib/geo";
import { parseMapLink } from "@/lib/view-scope";

/** Contiguous United States, with a little margin so the coasts stay on screen. */
export const UNITED_STATES_FRAME: LngLatBounds = {
  west: -125,
  south: 24.2,
  east: -66.5,
  north: 49.4,
};

/** The camera a plain visit uses. Zoomed on the US, not the hemisphere. */
export const DEFAULT_HOME_VIEW = { lat: 38.4, lon: -98.2, zoom: 4.15 };

/** Stop a chase tap from zooming into streets, where a small swath disappears. */
export const CHASE_LANDING_MAX_ZOOM = 11.5;

/** Padding for a chase landing after the sheet has closed. The old 260px bottom pad was for the open sheet and shoved the hail up off a phone. */
export function chaseLandingPadding(mobile: boolean): { top: number; bottom: number; left: number; right: number } {
  return mobile
    ? { top: 176, bottom: 84, left: 18, right: 58 }
    : { top: 112, bottom: 56, left: 40, right: 72 };
}

/**
 * A plain visit opens on the continental US. `?lat=&lon=` is an explicit place.
 * A stored pan is not: it was sending first-time and returning visitors to empty corners.
 */
export function initialCamera(params: URLSearchParams): { lat: number; lon: number; zoom: number } {
  return parseMapLink(params) ?? { ...DEFAULT_HOME_VIEW };
}

/**
 * After the weekly sheet closes, go back to the saved camera.
 * A zoom under 3 is the old hemisphere fit, so fall back to the default US view.
 */
export function homeViewAfterChase(saved: { lat: number; lon: number; zoom: number } | null): {
  lat: number;
  lon: number;
  zoom: number;
} {
  if (!saved || !(saved.zoom >= 3)) return { ...DEFAULT_HOME_VIEW };
  return { lat: saved.lat, lon: saved.lon, zoom: saved.zoom };
}

/**
 * Keep an automatic hail frame inside the US. A radar cell in Canada was
 * stretching the national view up to Hudson Bay.
 */
export function frameInsideUnitedStates(bounds: LngLatBounds): LngLatBounds {
  const west = Math.max(bounds.west, UNITED_STATES_FRAME.west);
  const east = Math.min(bounds.east, UNITED_STATES_FRAME.east);
  const south = Math.max(bounds.south, UNITED_STATES_FRAME.south);
  const north = Math.min(bounds.north, UNITED_STATES_FRAME.north);
  if (!(east > west) || !(north > south)) return { ...UNITED_STATES_FRAME };
  return { west, south, east, north };
}

/** Matches `--chase-map-gap` (13.5rem) on the phone sheet. */
export const CHASE_MAP_GAP_PX = 216;

/** Matches the extra pixels in `--chrome-offset` (`chromePx + 8`). */
const CHROME_OFFSET_EXTRA_PX = 8;

/**
 * Pixel inset so the contiguous US fills the map above the chase sheet.
 * Padding that is taller than that gap shrinks the country and the rest of
 * the phone shows the whole Americas.
 */
export function chaseMapPadding(input: { mobile: boolean; chromePx: number; mapHeight: number; sheet: boolean }): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (input.sheet && input.mobile) {
    const top = Math.max(0, Math.round(input.chromePx));
    const sheetTop = top + CHROME_OFFSET_EXTRA_PX + CHASE_MAP_GAP_PX;
    const bottom = Math.max(0, Math.round(input.mapHeight - sheetTop));
    return { top, bottom, left: 6, right: 6 };
  }
  const top = input.mobile ? 48 : Math.max(64, input.chromePx + 8);
  return { top, bottom: 36, left: input.mobile ? 8 : 28, right: input.mobile ? 8 : 28 };
}
