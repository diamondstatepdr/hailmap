export type SheetSnap = "expanded" | "collapsed" | "dismissed";

/** Downward speed, in pixels per millisecond, that counts as a flick. */
export const SHEET_FLICK_DOWN = 0.55;
/** Upward speed, in pixels per millisecond, that counts as a flick. */
export const SHEET_FLICK_UP = -0.55;
/** Downward travel from the expanded snap that collapses the sheet. */
export const SHEET_COLLAPSE_PX = 56;
/** Downward travel from the expanded snap that dismisses the sheet. */
export const SHEET_DISMISS_PX = 140;
/** Upward travel from the collapsed snap that expands the sheet. */
export const SHEET_EXPAND_PX = 48;
/** Downward travel from the collapsed snap that dismisses the sheet. */
export const SHEET_COLLAPSED_DISMISS_PX = 48;

export interface SheetGestureInput {
  /** Snap the pointer started on. */
  from: "expanded" | "collapsed";
  /** Finger travel. Positive moves the sheet downward. */
  deltaY: number;
  /** Pointer speed. Positive is downward, in pixels per millisecond. */
  velocityY: number;
  /**
   * When false the sheet is already near its peek height, so a downward
   * drag dismisses instead of collapsing further.
   */
  collapsible?: boolean;
}

/**
 * Decide where a header drag should settle.
 * A short downward swipe collapses; a longer swipe or a flick dismisses.
 * An upward swipe expands. Content scrolling is not part of this gesture.
 */
export function resolveSheetGesture(input: SheetGestureInput): SheetSnap {
  const collapsible = input.collapsible !== false;
  const { from, deltaY, velocityY } = input;

  if (from === "collapsed") {
    if (deltaY <= -SHEET_EXPAND_PX || velocityY <= SHEET_FLICK_UP) return "expanded";
    if (deltaY >= SHEET_COLLAPSED_DISMISS_PX || velocityY >= SHEET_FLICK_DOWN) return "dismissed";
    return "collapsed";
  }

  if (!collapsible) {
    if (deltaY >= SHEET_COLLAPSE_PX || velocityY >= SHEET_FLICK_DOWN) return "dismissed";
    return "expanded";
  }

  const flungDown = velocityY >= SHEET_FLICK_DOWN && deltaY > 24;
  if (deltaY >= SHEET_DISMISS_PX || (flungDown && deltaY >= SHEET_COLLAPSE_PX + 40)) return "dismissed";
  if (deltaY >= SHEET_COLLAPSE_PX || flungDown) return "collapsed";
  return "expanded";
}
