import { haversineKm, validLatLon } from "@/lib/geo";

export interface SavedView {
  lat: number;
  lon: number;
  zoom: number;
}

const VIEW_KEY = "hailmap-view";

function numberParam(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `?lat=&lon=&z=` opens the map on that point. `zoom` is accepted as an alias of `z`. */
export function parseMapLink(params: URLSearchParams): SavedView | null {
  const lat = numberParam(params.get("lat"));
  const lon = numberParam(params.get("lon"));
  if (lat == null || lon == null || !validLatLon(lat, lon)) return null;
  const zoomRaw = numberParam(params.get("z") ?? params.get("zoom"));
  const zoom = zoomRaw != null && zoomRaw >= 2 && zoomRaw <= 18 ? zoomRaw : 11;
  return { lat, lon, zoom };
}

export function readSavedView(): SavedView | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "") as Partial<SavedView>;
    const lat = Number(parsed.lat);
    const lon = Number(parsed.lon);
    if (!validLatLon(lat, lon)) return null;
    const zoom = Number(parsed.zoom);
    return { lat, lon, zoom: zoom >= 2 && zoom <= 18 ? zoom : 10 };
  } catch {
    return null;
  }
}

export function writeSavedView(view: SavedView): void {
  if (typeof localStorage === "undefined") return;
  if (!validLatLon(view.lat, view.lon)) return;
  const zoom = view.zoom >= 2 && view.zoom <= 18 ? view.zoom : 10;
  localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: view.lat, lon: view.lon, zoom }));
}

export function viewScopeLabel(
  bounds: { west: number; south: number; east: number; north: number } | null,
  stateCode = "",
): string {
  const state = stateCode.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) return `Showing: ${state}`;
  if (!bounds) return "Showing: all of US";
  const span = haversineKm(bounds.south, bounds.west, bounds.north, bounds.east);
  if (!Number.isFinite(span) || span > 2000) return "Showing: all of US";
  return "Showing: this map area";
}

export function zoomFromBounds(bounds: { west: number; south: number; east: number; north: number }): number {
  const latSpan = Math.max(0.02, bounds.north - bounds.south);
  const zoom = Math.log2(160 / latSpan);
  return Math.max(2, Math.min(16, Math.round(zoom * 10) / 10));
}
