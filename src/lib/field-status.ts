/** Street lookup gives up and shows coordinates after this long. */
export const FIELD_LOOKUP_MS = 3000;

export interface FieldPoint {
  lat: number;
  lon: number;
}

export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * GPS, then the address the tech already searched, then the middle of the map.
 * Field mode uses this when the browser blocks location or the fix is late.
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
