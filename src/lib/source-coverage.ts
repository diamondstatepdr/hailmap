import { MESH_ARCHIVE_START, MESH_AWS_START, MESH_INSTANT_START, SPC_HAIL_WIND_START, SPC_TORNADO_START, VTEC_POINT_START } from "@/lib/history-coverage";
import { addIsoDays } from "@/lib/mesh-plan";

export interface SourceSpan {
  source: string;
  years: string;
  detail: string;
}

/** Plain statement of which years each source can cover. Dates are the ones probed in the public archives. */
export function sourceCoverage(span: { start: string; end: string }): SourceSpan[] {
  return [
    {
      source: "Spotter reports",
      years: `Hail and wind from ${SPC_HAIL_WIND_START.slice(0, 4)}. Tornadoes from ${SPC_TORNADO_START.slice(0, 4)}.`,
      detail: `Showing ${span.start} through ${span.end}. Earlier years stay in this archive.`,
    },
    {
      source: "Radar hail",
      years: `24-hour maximum from ${MESH_ARCHIVE_START}. Hourly sample from ${MESH_INSTANT_START} through ${addIsoDays(MESH_ARCHIVE_START, -1)}.`,
      detail: `No free nationwide radar hail before ${MESH_INSTANT_START}. The AWS copy starts ${MESH_AWS_START}. Older years use spotter reports.`,
    },
    {
      source: "NWS warnings",
      years: `From ${VTEC_POINT_START.slice(0, 4)} at an address.`,
      detail: "Point warnings come from the Iowa Environmental Mesonet.",
    },
  ];
}
