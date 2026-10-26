import { describe, expect, it } from "vitest";
import { repairPlaceName } from "@/lib/place-name";
import { relaxPlaceLabels, type PlaceLabelMap } from "@/lib/place-labels";
import { townFromLocation } from "@/lib/chase-place";

describe("Flagstaff place names", () => {
  it("repairs the missing f in city labels", () => {
    expect(repairPlaceName("Flagstaf")).toBe("Flagstaff");
    expect(repairPlaceName("FLAGSTAF, AZ")).toBe("FLAGSTAFF, AZ");
    expect(repairPlaceName("near flagstaf")).toBe("near flagstaff");
    expect(repairPlaceName("Flagstaff")).toBe("Flagstaff");
  });

  it("repairs a truncated town from a spotter string", () => {
    expect(townFromLocation("4 NE Flagstaf")).toBe("Flagstaff");
  });

  it("gives city labels room for the last letter and drops uppercase wrapping", () => {
    const layout = new Map<string, Map<string, unknown>>();
    const map: PlaceLabelMap = {
      getLayer: (id) => (id === "place_city" || id === "label_city" ? {} : undefined),
      getLayoutProperty: (layer, name) => layout.get(layer)?.get(name),
      setLayoutProperty: (layer, name, value) => {
        const row = layout.get(layer) ?? new Map<string, unknown>();
        row.set(name, value);
        layout.set(layer, row);
      },
    };
    map.setLayoutProperty("place_city", "text-transform", "uppercase");
    map.setLayoutProperty("place_city", "text-max-width", 8);
    relaxPlaceLabels(map);
    expect(map.getLayoutProperty("place_city", "text-transform")).toBe("none");
    expect(map.getLayoutProperty("place_city", "text-max-width")).toBe(14);
    expect(map.getLayoutProperty("place_city", "text-padding")).toBe(8);
    expect(map.getLayoutProperty("label_city", "text-padding")).toBe(8);
    relaxPlaceLabels(map);
    expect(map.getLayoutProperty("place_city", "text-transform")).toBe("none");
  });
});
