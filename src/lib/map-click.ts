/** A rendered map feature the click handler can see. */
export interface MapClickFeature {
  layerId: string;
  id?: string | null;
  clusterId?: number | null;
}

export type MapClickChoice =
  | { type: "report"; id: string }
  | { type: "hail-cluster"; clusterId: number }
  | { type: "swath" }
  | { type: "other" };

const REPORT_LAYERS = new Set(["hail-points", "hail-point-hit"]);

function isSwathLayer(layerId: string): boolean {
  if (layerId === "swath-fill") return true;
  if (layerId === "mesh-fill" || layerId === "mesh-pulse-fill") return true;
  return layerId.startsWith("mesh-a") || layerId.startsWith("mesh-b") || layerId.startsWith("mesh-pulse-");
}

/**
 * A report dot wins over the swath underneath it. The old order checked
 * mesh-fill first, so a tap on a dot opened the dealer search and the paywall.
 */
export function chooseMapClick(features: MapClickFeature[]): MapClickChoice {
  for (const feature of features) {
    if (REPORT_LAYERS.has(feature.layerId) && feature.id) return { type: "report", id: feature.id };
  }
  for (const feature of features) {
    if (feature.layerId === "hail-clusters" && feature.clusterId != null) {
      return { type: "hail-cluster", clusterId: feature.clusterId };
    }
  }
  if (features.some((feature) => isSwathLayer(feature.layerId))) return { type: "swath" };
  return { type: "other" };
}
