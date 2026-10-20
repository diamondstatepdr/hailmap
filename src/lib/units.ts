/** Statute miles. Address search, alerts, and distances on screen use this set. */
export const SEARCH_RADIUS_MILES = [1, 3, 5, 10, 25] as const;
export type SearchRadiusMi = (typeof SEARCH_RADIUS_MILES)[number];

export const DEFAULT_RADIUS_MI: SearchRadiusMi = 5;

export const KM_PER_MILE = 1.609344;

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

export function isSearchRadiusMi(value: number): value is SearchRadiusMi {
  return (SEARCH_RADIUS_MILES as readonly number[]).includes(value);
}

/** Snap a stored kilometre radius onto the mile chips. */
export function nearestRadiusMi(km: number): SearchRadiusMi {
  const miles = kmToMiles(km);
  return SEARCH_RADIUS_MILES.reduce((best, item) => (Math.abs(item - miles) < Math.abs(best - miles) ? item : best));
}

/** Short distance. Values under 10 miles keep one decimal. */
export function formatMiles(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  const miles = kmToMiles(km);
  if (miles < 10) {
    const rounded = Math.round(miles * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded.toFixed(0)} mi` : `${rounded.toFixed(1)} mi`;
  }
  return `${Math.round(miles)} mi`;
}

export function formatInches(value: number): string {
  return `${value.toFixed(2)} in`;
}

/**
 * Put the source and the search radius on a hail size so radar, spotter, and
 * map-view totals are not read as the same measurement.
 */
export function formatHailSources(input: {
  radarIn?: number | null;
  spotterIn?: number | null;
  radiusKm?: number | null;
}): string {
  const parts: string[] = [];
  if (input.radarIn != null && input.radarIn > 0) parts.push(`${formatInches(input.radarIn)} radar`);
  if (input.spotterIn != null && input.spotterIn > 0) parts.push(`${formatInches(input.spotterIn)} spotter`);
  if (!parts.length) return "No hail size in this range";
  const where = input.radiusKm != null && input.radiusKm > 0 ? ` within ${formatMiles(input.radiusKm)}` : "";
  return `${parts.join(" · ")}${where}`;
}
