import type { LngLatBounds } from "@/lib/geo";

/** Contiguous United States, with a little margin so the coasts stay on screen. */
export const UNITED_STATES_FRAME: LngLatBounds = {
  west: -125,
  south: 24.2,
  east: -66.5,
  north: 49.4,
};

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

/** Matches `--chase-map-gap` on the phone sheet. Chip row plus a clear view of the country. */
const PHONE_SHEET_GAP_PX = 216;

/** Pixel inset so the country sits in the map that is not covered by the chase sheet. */
export function chaseMapPadding(input: { mobile: boolean; chromePx: number; mapHeight: number; sheet: boolean }): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const top = input.sheet && input.mobile ? Math.max(72, input.chromePx + 64) : input.mobile ? 48 : Math.max(64, input.chromePx + 8);
  let bottom = input.sheet && input.mobile ? Math.max(48, input.mapHeight - input.chromePx - PHONE_SHEET_GAP_PX) : 36;
  const band = 140;
  if (top + bottom > input.mapHeight - band) bottom = Math.max(48, input.mapHeight - top - band);
  return { top, bottom, left: input.mobile ? 8 : 28, right: input.mobile ? 8 : 28 };
}
