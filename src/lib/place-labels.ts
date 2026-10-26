/** Basemap city layers whose last letter can be clipped (Flagstaff → Flagstaf). */
export const PLACE_LABEL_LAYERS = [
  "label_city",
  "label_city_capital",
  "label_town",
  "label_village",
  "place_city",
  "place_city_large",
  "place_town",
  "place_village",
  "place_suburb",
  "place_other",
] as const;

export interface PlaceLabelMap {
  getLayer(id: string): unknown;
  getLayoutProperty(layer: string, name: string): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): void;
}

/**
 * Keep place names on one line and give the last glyph room.
 * Uppercase plus a tight wrap width was shaving the final f off Flagstaff.
 */
export function relaxPlaceLabels(map: PlaceLabelMap): void {
  for (const id of PLACE_LABEL_LAYERS) {
    if (!map.getLayer(id)) continue;
    if (map.getLayoutProperty(id, "text-padding") !== 8) map.setLayoutProperty(id, "text-padding", 8);
    if (map.getLayoutProperty(id, "text-max-width") !== 14) map.setLayoutProperty(id, "text-max-width", 14);
    if (map.getLayoutProperty(id, "text-transform") !== "none") map.setLayoutProperty(id, "text-transform", "none");
  }
}
