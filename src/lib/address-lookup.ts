import { milesToKm } from "@/lib/units";

export interface AddressSelection {
  label: string;
  lat: number;
  lon: number;
}

/** The Addresses tab asks the live place API for this radius and time window. */
export function addressLookupUrl(input: { lat: number; lon: number; radiusKm: number; hours: number }): string {
  const params = new URLSearchParams({
    lat: String(input.lat),
    lon: String(input.lon),
    radiusKm: String(input.radiusKm),
    hours: String(input.hours),
  });
  return `/api/place?${params}`;
}

/**
 * Picking a suggestion starts a lookup immediately. History stays empty until
 * that request returns, which is what shows the loading state instead of the
 * empty "Search an address" card.
 */
export function beginAddressSelection(hit: AddressSelection, radiusMi: number, hours: number) {
  return {
    loading: true as const,
    history: null,
    label: hit.label,
    lat: hit.lat,
    lon: hit.lon,
    url: addressLookupUrl({ lat: hit.lat, lon: hit.lon, radiusKm: milesToKm(radiusMi), hours }),
  };
}
