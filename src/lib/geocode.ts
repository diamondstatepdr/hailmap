export interface PlaceLabel {
  location: string | null;
  county: string | null;
  state: string | null;
}

const EMPTY_PLACE: PlaceLabel = { location: null, county: null, state: null };

function text(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function firstBase(list: unknown): string | null {
  if (!Array.isArray(list) || !list[0] || typeof list[0] !== "object") return null;
  const row = list[0] as Record<string, unknown>;
  return text(row.BASENAME) ?? text(row.NAME);
}

/** Read a Census geographies/coordinates payload into a short place label. */
export function placeFromCensus(payload: unknown): PlaceLabel {
  if (!payload || typeof payload !== "object") return EMPTY_PLACE;
  const geographies = (payload as { result?: { geographies?: Record<string, unknown> } }).result?.geographies;
  if (!geographies) return EMPTY_PLACE;
  const stateRow = Array.isArray(geographies.States) ? geographies.States[0] : null;
  const stateRaw =
    stateRow && typeof stateRow === "object" ? text((stateRow as Record<string, unknown>).STUSAB, 8) : null;
  const state = stateRaw && /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : null;
  return {
    location: firstBase(geographies["Incorporated Places"]) ?? firstBase(geographies["Census Designated Places"]),
    county: firstBase(geographies.Counties),
    state,
  };
}

/** Best-effort US place name. Failure leaves the confirmed coordinates as the location. */
export async function lookupPlace(lat: number, lon: number): Promise<PlaceLabel> {
  try {
    const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
    url.searchParams.set("x", lon.toFixed(6));
    url.searchParams.set("y", lat.toFixed(6));
    url.searchParams.set("benchmark", "Public_AR_Current");
    url.searchParams.set("vintage", "Current_Current");
    url.searchParams.set("format", "json");
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          process.env.HAILMAP_USER_AGENT?.trim() ||
          "HailMap/1.0 (https://github.com/diamondstatepdr/hailmap)",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return EMPTY_PLACE;
    return placeFromCensus(await response.json());
  } catch {
    return EMPTY_PLACE;
  }
}
