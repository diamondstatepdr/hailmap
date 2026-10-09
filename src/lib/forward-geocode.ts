import { validLatLon } from "@/lib/geo";

export interface GeocodeHit {
  label: string;
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
  zip: string | null;
  source: "census" | "nominatim";
}

export interface GeocodeCache {
  get(query: string): GeocodeHit[] | null;
  set(query: string, places: GeocodeHit[], ttlMs: number): void;
}

const EMPTY: GeocodeHit[] = [];
let lastNominatim = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

export function normalizeGeocodeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").slice(0, 120).toLowerCase();
}

function text(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function userAgent(): string {
  return (
    process.env.HAILMAP_USER_AGENT?.trim() ||
    "HailMap/1.0 (https://github.com/diamondstatepdr/hailmap)"
  );
}

/** Census onelineaddress matches. Coordinates are x=lon, y=lat. */
export function parseCensusLocations(payload: unknown): GeocodeHit[] {
  const matches = (payload as { result?: { addressMatches?: unknown } } | null)?.result?.addressMatches;
  if (!Array.isArray(matches)) return [];
  const hits: GeocodeHit[] = [];
  for (const match of matches) {
    if (!match || typeof match !== "object") continue;
    const row = match as Record<string, unknown>;
    const coordinates = row.coordinates as { x?: unknown; y?: unknown } | undefined;
    const lon = Number(coordinates?.x);
    const lat = Number(coordinates?.y);
    if (!validLatLon(lat, lon)) continue;
    const parts = (row.addressComponents ?? {}) as Record<string, unknown>;
    const stateRaw = text(parts.state, 8);
    hits.push({
      label: text(row.matchedAddress, 180) ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      lat,
      lon,
      city: text(parts.city, 80),
      state: stateRaw && /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : stateRaw,
      zip: text(parts.zip, 10),
      source: "census",
    });
    if (hits.length >= 5) break;
  }
  return hits;
}

/** Nominatim search results, limited to coordinates that fall in range. */
export function parseNominatim(payload: unknown): GeocodeHit[] {
  if (!Array.isArray(payload)) return [];
  const hits: GeocodeHit[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (!validLatLon(lat, lon)) continue;
    const address = (row.address ?? {}) as Record<string, unknown>;
    const city = text(address.city, 80) ?? text(address.town, 80) ?? text(address.village, 80);
    const state = text(address.state, 40);
    hits.push({
      label: text(row.display_name, 180) ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      lat,
      lon,
      city,
      state,
      zip: text(address.postcode, 12),
      source: "nominatim",
    });
    if (hits.length >= 5) break;
  }
  return hits;
}

export function streetFromNominatim(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const address = (payload as { address?: Record<string, unknown> }).address;
  if (!address) return null;
  const road = text(address.road, 80) ?? text(address.pedestrian, 80);
  const city = text(address.city, 80) ?? text(address.town, 80) ?? text(address.village, 80);
  if (road && city) return `${road}, ${city}`;
  return road ?? city;
}

async function nominatim(url: string): Promise<unknown> {
  const run = nominatimQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastNominatim));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatim = Date.now();
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent() },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);
    return response.json();
  });
  nominatimQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function forwardGeocode(query: string, cache?: GeocodeCache): Promise<GeocodeHit[]> {
  const key = normalizeGeocodeQuery(query);
  if (key.length < 3) return EMPTY;
  const cached = cache?.get(key);
  if (cached) return cached;
  let places: GeocodeHit[] = [];
  try {
    const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    url.searchParams.set("address", query.trim().slice(0, 120));
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("format", "json");
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": userAgent() },
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) places = parseCensusLocations(await response.json());
  } catch (error) {
    console.error("[hailmap] census geocode", error instanceof Error ? error.message : error);
  }
  if (!places.length) {
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("q", query.trim().slice(0, 120));
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("limit", "5");
      url.searchParams.set("countrycodes", "us");
      places = parseNominatim(await nominatim(url.toString()));
    } catch (error) {
      console.error("[hailmap] nominatim", error instanceof Error ? error.message : error);
    }
  }
  cache?.set(key, places, places.length ? 30 * 86400000 : 60 * 60 * 1000);
  return places;
}

export async function reverseStreet(lat: number, lon: number, cache?: GeocodeCache): Promise<string | null> {
  if (!validLatLon(lat, lon)) return null;
  const key = `reverse:${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cache?.get(key);
  if (cached) return cached[0]?.label ?? null;
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", lat.toFixed(5));
    url.searchParams.set("lon", lon.toFixed(5));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    const street = streetFromNominatim(await nominatim(url.toString()));
    cache?.set(key, street ? [{ label: street, lat, lon, city: null, state: null, zip: null, source: "nominatim" }] : [], street ? 7 * 86400000 : 60 * 60 * 1000);
    return street;
  } catch (error) {
    console.error("[hailmap] reverse", error instanceof Error ? error.message : error);
    return null;
  }
}
