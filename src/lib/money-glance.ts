import { DEFAULT_WINDOW_HOURS, timeWindowFor } from "@/lib/filters";
import { pointInGeometry } from "@/lib/geo";
import { inBounds, type HoneyBounds } from "@/lib/honey";
import { formatHoneyDetail } from "@/lib/plain";

export const MONEY_ZOOM_HINT = "Zoom in to a city to see the best stops.";
export const MONEY_LOADING_HINT = "Finding the best lots and neighborhoods…";
export const MONEY_MAP_HINT = "Scores follow the hail on the map.";

export interface GlancePlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  score: number;
  level: string;
  hailIn: number;
  radarIn?: number | null;
  spotterIn?: number | null;
  count: number | null;
  noun: "cars" | "homes";
  bounds?: HoneyBounds | null;
}

export interface GlanceHit {
  lat: number;
  lon: number;
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  spotId?: string | null;
}

export interface GlanceScore {
  id: string;
  name: string;
  score: number;
  level: string;
  detail: string;
}

export interface MoneyGlanceContext {
  spots: GlancePlace[];
  areas: GlancePlace[];
  zoomedOut: boolean;
  loading: boolean;
}

type MapHistoryKind = "window" | "day" | "days" | "custom";

/** The rank request for whatever hail the map is already showing. Empty when the map has no hail path. */
export function honeyQueryFromMap(input: {
  bounds: HoneyBounds | null;
  historyKind: MapHistoryKind;
  day: string | null;
  hours: number;
  originLat: number | null;
  originLon: number | null;
}): string {
  const bounds = input.bounds;
  if (!bounds) return "";
  const day = input.historyKind === "day" ? input.day : null;
  const window = !day && input.historyKind === "window" ? timeWindowFor(input.hours) : undefined;
  if (!day && !window) return "";
  const params = new URLSearchParams({
    west: bounds.west.toFixed(2),
    south: bounds.south.toFixed(2),
    east: bounds.east.toFixed(2),
    north: bounds.north.toFixed(2),
  });
  if (day) params.set("date", day);
  else if (window) params.set("hours", String(window.hours));
  const lat = input.originLat ?? (bounds.south + bounds.north) / 2;
  const lon = input.originLon ?? (bounds.west + bounds.east) / 2;
  params.set("lat", lat.toFixed(4));
  params.set("lon", lon.toFixed(4));
  return params.toString();
}

/**
 * Weekly area scores match the default map (last 7 days) and a storm day inside that week.
 * A shorter live window is a different set of hail, so those scores stay off.
 */
export function areasFollowMap(input: {
  historyKind: MapHistoryKind;
  hours: number;
  date: string | null;
  chaseStart: string | null;
  chaseEnd: string | null;
}): boolean {
  if (!input.chaseStart || !input.chaseEnd) return false;
  if (input.historyKind === "window") {
    const window = timeWindowFor(input.hours);
    return Boolean(window && window.hours >= DEFAULT_WINDOW_HOURS);
  }
  if (input.historyKind === "day" && input.date) {
    return input.date >= input.chaseStart && input.date <= input.chaseEnd;
  }
  return false;
}

function toScore(place: GlancePlace): GlanceScore {
  return {
    id: place.id,
    name: place.name,
    score: place.score,
    level: place.level,
    detail: formatHoneyDetail({
      radarIn: place.radarIn,
      spotterIn: place.spotterIn,
      hailIn: place.hailIn,
      count: place.count,
      noun: place.noun,
    }),
  };
}

function best(places: GlancePlace[]): GlancePlace | null {
  let chosen: GlancePlace | null = null;
  for (const place of places) {
    if (!chosen || place.score > chosen.score || (place.score === chosen.score && place.name < chosen.name)) chosen = place;
  }
  return chosen;
}

function pickScore(hit: GlanceHit, input: MoneyGlanceContext): GlanceScore | null {
  if (hit.spotId) {
    const spot = input.spots.find((item) => item.id === hit.spotId);
    if (spot) return toScore(spot);
  }
  const spots = input.spots.filter((spot) => (hit.geometry ? pointInGeometry(spot.lon, spot.lat, hit.geometry) : false));
  const spot = best(spots);
  if (spot) return toScore(spot);
  const areas = input.areas.filter((area) => {
    if (hit.geometry && pointInGeometry(area.lon, area.lat, hit.geometry)) return true;
    return Boolean(area.bounds && inBounds(hit.lat, hit.lon, area.bounds));
  });
  const area = best(areas);
  return area ? toScore(area) : null;
}

/** Score for the hail path, money spot, or ranked area under the pointer. */
export function glanceAt(hit: GlanceHit, input: MoneyGlanceContext): { score: GlanceScore | null; hint: string | null } {
  const score = pickScore(hit, input);
  if (score) return { score, hint: null };
  if (input.zoomedOut) return { score: null, hint: MONEY_ZOOM_HINT };
  if (input.loading) return { score: null, hint: MONEY_LOADING_HINT };
  return { score: null, hint: null };
}
