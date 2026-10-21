import { parseMapLink, type SavedView } from "@/lib/view-scope";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface OpeningView {
  honey: boolean;
  /** Storm day from `day` or `date`, kept for the header and the honey query. */
  day: string | null;
  bounds: boolean;
  center: boolean;
  address: boolean;
  savedView: boolean;
  /** Honey, a map link, or a saved view already chose the camera. */
  requestsView: boolean;
}

function finite(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `west/south/east/north` on a honey share or any other map link. */
export function linkedBounds(params: URLSearchParams): boolean {
  const west = finite(params.get("west"));
  const south = finite(params.get("south"));
  const east = finite(params.get("east"));
  const north = finite(params.get("north"));
  return west != null && south != null && east != null && north != null && south < north && west < east;
}

/** The storm day a share link asked for. `date` is the replay alias of `day`. */
export function stormDayFromLink(params: URLSearchParams): string | null {
  const day = params.get("day") ?? params.get("date");
  return day && DAY.test(day) ? day : null;
}

/**
 * What the page asked to show before the weekly chase list loads.
 * A saved view counts even when this URL is bare.
 */
export function describeOpening(params: URLSearchParams, saved: SavedView | null): OpeningView {
  const honey = params.get("honey") === "1";
  const day = stormDayFromLink(params);
  const bounds = linkedBounds(params);
  const center =
    parseMapLink(params) != null || (finite(params.get("focusLat")) != null && finite(params.get("focusLon")) != null);
  const address = params.get("card") === "address";
  const savedView = saved != null;
  return {
    honey,
    day,
    bounds,
    center,
    address,
    savedView,
    requestsView: honey || bounds || center || day != null || address || savedView,
  };
}

/**
 * Share and alert links choose a panel or a place. A saved view does not:
 * opening the app on `/` still gets the weekly sheet.
 */
export function suppressesWeeklyChase(params: URLSearchParams, opening: OpeningView): boolean {
  if (opening.honey || opening.bounds || opening.center || opening.day != null || opening.address) return true;
  if (params.get("reportId")) return true;
  if (params.get("replay") === "1") return true;
  if (params.get("section") === "alerts") return true;
  return false;
}

export interface ChaseSheets {
  honey: boolean;
  address: boolean;
  replay: boolean;
  filters: boolean;
  report: boolean;
  calendar: boolean;
  detail: boolean;
}

/** Money Holes, address, replay, and the other map sheets. The chase list must not cover these. */
export function chaseBlockedBySheet(sheets: ChaseSheets): boolean {
  return sheets.honey || sheets.address || sheets.replay || sheets.filters || sheets.report || sheets.calendar || sheets.detail;
}

/**
 * Auto-open only on a plain map visit. A deep link or an open sheet skips it
 * without marking the week dismissed or seen.
 */
export function weeklyChaseShouldAutoOpen(input: {
  pending: boolean;
  deepLink: boolean;
  sheetOpen: boolean;
  onMap: boolean;
}): boolean {
  return input.pending && input.onMap && !input.deepLink && !input.sheetOpen;
}

export interface ChaseFrameState {
  chaseReady: boolean;
  /** The weekly sheet is on screen. */
  popupOpen: boolean;
  /** The sheet opened on its own for a week the visitor has not dismissed. */
  autoOpen: boolean;
  /** `?honey=1`, a bounds/center/day link, an address link, or a saved view. */
  requestedView: boolean;
  /** The visitor panned, zoomed, searched, or started a replay. */
  userMoved: boolean;
  replayActive: boolean;
  flyingToStop: boolean;
  /** The country was already fit for this auto-opened sheet. */
  nationalShown: boolean;
}

export interface ChaseFrameResult {
  /** Fit the contiguous United States behind the weekly sheet. */
  frameUnitedStates: boolean;
  /** Keep mesh and geolocation from replacing the camera. */
  lockFrame: boolean;
}

/**
 * The country frame is only for the weekly sheet auto-opening on a map
 * nobody else has claimed. Share links, saved views, replays, and a
 * camera the visitor already moved stay where they are, lock included.
 */
export function chaseFrameResult(state: ChaseFrameState): ChaseFrameResult {
  if (!state.chaseReady) return { frameUnitedStates: false, lockFrame: true };
  if (state.requestedView || state.userMoved || state.replayActive || state.flyingToStop) {
    return { frameUnitedStates: false, lockFrame: true };
  }
  if (state.popupOpen && state.autoOpen) return { frameUnitedStates: true, lockFrame: true };
  if (state.popupOpen || state.autoOpen || state.nationalShown) {
    return { frameUnitedStates: false, lockFrame: true };
  }
  return { frameUnitedStates: false, lockFrame: false };
}
