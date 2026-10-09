import type { Confidence } from "@/lib/confidence";
import { HAZARDS, type Hazard } from "@/lib/hazard";
import type { ReportFilter } from "@/lib/filters";

export type { ReportFilter };

export const CONFIDENCE_OPTIONS: Array<{ id: Confidence; label: string }> = [
  { id: "nws", label: "Official (NWS)" },
  { id: "spotter", label: "Spotter" },
  { id: "mesh", label: "Radar (MESH)" },
  { id: "community", label: "Community" },
];

export const HAZARD_OPTIONS: Array<{ id: Hazard; label: string }> = [
  { id: "hail", label: "Hail" },
  { id: "wind", label: "Wind" },
  { id: "tornado", label: "Tornado" },
];

export function defaultFilter(): ReportFilter {
  return {
    minSize: 0,
    hours: 168,
    confidences: ["nws", "spotter", "mesh", "community"],
    state: "",
    hazards: [...HAZARDS],
  };
}

export function confidenceLabel(id: Confidence): string {
  return CONFIDENCE_OPTIONS.find((option) => option.id === id)?.label ?? id;
}
