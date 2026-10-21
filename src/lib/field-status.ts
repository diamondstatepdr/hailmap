import { haversineKm } from "@/lib/geo";

/** Street lookup gives up and shows coordinates after this long. */
export const FIELD_LOOKUP_MS = 3000;

/** A house pin may use GPS only when the fix is this close to the map center. */
export const PIN_GPS_MAX_KM = 1;

export type FieldAnchorSource = "selection" | "search" | "map" | "gps";

export interface FieldAnchor extends FieldPoint {
  source: FieldAnchorSource;
}

export interface FieldPoint {
  lat: number;
  lon: number;
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Older helper: a live GPS fix, then a searched address, then the map center.
 * Field mode no longer calls this. Scouting uses resolveFieldAnchor.
 */
export function fieldFallbackPoint(input: {
  gps: FieldPoint | null;
  searched: FieldPoint | null;
  view: { west: number; south: number; east: number; north: number } | null;
}): (FieldPoint & { source: "gps" | "search" | "map" }) | null {
  if (input.gps) return { ...input.gps, source: "gps" };
  if (input.searched) return { ...input.searched, source: "search" };
  if (!input.view) return null;
  return {
    lat: (input.view.south + input.view.north) / 2,
    lon: (input.view.west + input.view.east) / 2,
    source: "map",
  };
}

export function boundsCenter(
  view: { west: number; south: number; east: number; north: number } | null,
): FieldPoint | null {
  if (!view) return null;
  return {
    lat: (view.south + view.north) / 2,
    lon: (view.west + view.east) / 2,
  };
}

/**
 * Where Field mode scores, labels streets, and searches for dealers.
 * A chosen storm or report wins, then a searched address, then the map.
 * GPS is not an automatic choice. It is returned only when the tech tapped
 * Center on me and no storm, search, or map center is available.
 */
export function resolveFieldAnchor(input: {
  selection: FieldPoint | null;
  search: FieldPoint | null;
  map: FieldPoint | null;
  gps?: FieldPoint | null;
  gpsChosen?: boolean;
}): FieldAnchor | null {
  if (input.selection) return { ...input.selection, source: "selection" };
  if (input.search) return { ...input.search, source: "search" };
  if (input.map) return { ...input.map, source: "map" };
  if (input.gpsChosen && input.gps) return { ...input.gps, source: "gps" };
  return null;
}

/**
 * House pins land on a tapped point, or on GPS when location is on and the
 * fix is within about a kilometer of the map. Otherwise they use the map center.
 */
export function fieldPinPoint(input: {
  gps: FieldPoint | null;
  locationOn: boolean;
  mapCenter: FieldPoint | null;
  tapped?: FieldPoint | null;
}): FieldPoint | null {
  if (input.tapped) return input.tapped;
  if (input.locationOn && input.gps && input.mapCenter) {
    const away = haversineKm(input.gps.lat, input.gps.lon, input.mapCenter.lat, input.mapCenter.lon);
    if (away <= PIN_GPS_MAX_KM) return input.gps;
  }
  return input.mapCenter;
}

export function fieldStreetTitle(input: {
  street: string | null;
  status: "idle" | "loading" | "unavailable" | "ok";
  lat: number | null;
  lon: number | null;
  waitedMs: number;
}): string {
  if (input.street) return input.street;
  const coords = input.lat != null && input.lon != null ? formatCoords(input.lat, input.lon) : null;
  const stalled = input.waitedMs >= FIELD_LOOKUP_MS;
  if (input.status === "loading" && !stalled) return "Looking up the street…";
  if (coords) return coords;
  if (input.status === "loading") return "Looking up the street…";
  return "Waiting for a location…";
}

export function fieldScoreCopy(input: { score: number | null; windowLabel: string }): { showScore: boolean; message: string } {
  if (input.score == null) {
    return { showScore: false, message: "Score appears when a location is known." };
  }
  if (input.score <= 0) {
    return {
      showScore: false,
      message: `No hail here in the ${input.windowLabel}. Widen to 90 days to look further back.`,
    };
  }
  return { showScore: true, message: "" };
}
