import { haversineKm } from "@/lib/geo";
import { hazardLabel, hazardOf, magnitudeLabel } from "@/lib/hazard";
import type { DamageScore } from "@/lib/probability";
import type { PlaceHistory, PlaceWarning } from "@/lib/place";
import type { FieldPin } from "@/lib/accounts";
import { pinStatusLabel } from "@/lib/field";
import type { HailReport } from "@/lib/types";

export interface StormReportDocument {
  id: string;
  title: string;
  createdAt: string;
  kind: "address" | "area";
  place: {
    label: string;
    lat: number;
    lon: number;
    radiusKm: number | null;
    bounds: { west: number; south: number; east: number; north: number } | null;
  };
  hours: number;
  score: DamageScore;
  stats: {
    reportCount: number;
    maxHailIn: number | null;
    maxWindMph: number | null;
    strongestTornado: string | null;
    nearestKm: number | null;
    swathHit: boolean;
  };
  warnings: PlaceWarning[];
  warningNote: string | null;
  meshNote: string | null;
  timeline: Array<{
    id: string;
    hazard: string;
    magnitude: string;
    when: string;
    where: string;
    source: string;
    confidence: string;
    distanceKm: number | null;
    remark: string | null;
  }>;
  photos: Array<{
    url: string;
    damageType: string;
    note: string | null;
    takenAt: string;
    pinStatus: string;
  }>;
  sources: string[];
  svg: string;
  disclaimer: string;
}

const SOURCE_NAMES: Record<string, string> = {
  spc: "Storm Prediction Center local storm reports",
  iem: "Iowa Environmental Mesonet local storm reports",
  nws: "National Weather Service warning centroids",
  mesh: "MRMS MESH radar (HAILMAP_MESH_URL)",
  photo: "In-app community photo reports",
  import: "Imported community file",
  community: "Community webhook",
  spotter: "Spotter webhook",
  seed: "Sample data until a live feed responds",
};

function whereOf(report: Pick<HailReport, "location" | "county" | "state" | "lat" | "lon">): string {
  const parts = [report.location, report.county, report.state].filter((part): part is string => Boolean(part));
  return parts.join(", ") || `${report.lat.toFixed(3)}, ${report.lon.toFixed(3)}`;
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

export function sketchMap(
  points: Array<{ lon: number; lat: number; hazard: string }>,
  center: { lon: number; lat: number },
  bounds?: { west: number; south: number; east: number; north: number } | null,
): string {
  const pad = 0.15;
  let west = bounds?.west ?? center.lon - 0.2;
  let east = bounds?.east ?? center.lon + 0.2;
  let south = bounds?.south ?? center.lat - 0.15;
  let north = bounds?.north ?? center.lat + 0.15;
  for (const point of points) {
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
  }
  const lonSpan = Math.max(0.08, east - west);
  const latSpan = Math.max(0.06, north - south);
  west -= lonSpan * pad;
  east += lonSpan * pad;
  south -= latSpan * pad;
  north += latSpan * pad;
  const width = 640;
  const height = 360;
  const xOf = (lon: number) => ((lon - west) / (east - west)) * width;
  const yOf = (lat: number) => height - ((lat - south) / (north - south)) * height;
  const dots = points
    .slice(0, 400)
    .map((point) => {
      const color = point.hazard === "wind" ? "#1d4ed8" : point.hazard === "tornado" ? "#e11d48" : "#ea580c";
      return `<circle cx="${xOf(point.lon).toFixed(1)}" cy="${yOf(point.lat).toFixed(1)}" r="5.5" fill="${color}" fill-opacity="0.92" stroke="#ffffff" stroke-width="1.4"/>`;
    })
    .join("");
  const cx = xOf(center.lon);
  const cy = yOf(center.lat);
  const grid = [0.25, 0.5, 0.75]
    .map((step) => {
      const x = (width * step).toFixed(1);
      const y = (height * step).toFixed(1);
      return `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#d5e2ee" stroke-width="1"/><line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#d5e2ee" stroke-width="1"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Report locations">
    <rect width="${width}" height="${height}" fill="#eef4f8"/>
    ${grid}
    <rect x="14" y="12" width="292" height="22" rx="11" fill="#ffffff" fill-opacity="0.92"/>
    <circle cx="28" cy="23" r="4" fill="#ea580c"/>
    <circle cx="92" cy="23" r="4" fill="#1d4ed8"/>
    <circle cx="168" cy="23" r="4" fill="#e11d48"/>
    <text x="38" y="27" fill="#5c6d82" font-family="Inter, Segoe UI, sans-serif" font-size="11">Hail</text>
    <text x="102" y="27" fill="#5c6d82" font-family="Inter, Segoe UI, sans-serif" font-size="11">Wind</text>
    <text x="178" y="27" fill="#5c6d82" font-family="Inter, Segoe UI, sans-serif" font-size="11">Tornado</text>
    ${dots}
    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8" fill="none" stroke="#0c6278" stroke-width="2"/>
    <path d="M ${cx - 11} ${cy} H ${cx + 11} M ${cx} ${cy - 11} V ${cy + 11}" stroke="#0c6278" stroke-width="1.5"/>
  </svg>`;
}

export function buildStormReport(input: {
  id?: string;
  title: string;
  createdAt?: string;
  kind: "address" | "area";
  label: string;
  lat: number;
  lon: number;
  radiusKm: number | null;
  bounds: { west: number; south: number; east: number; north: number } | null;
  hours: number;
  history: PlaceHistory;
  listed: Array<HailReport & { distanceKm?: number }>;
  photos?: FieldPin[];
  meshStatus?: string | null;
  now?: string;
}): StormReportDocument {
  const createdAt = input.createdAt ?? input.now ?? new Date().toISOString();
  const listed = [...input.listed].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const sources = new Set<string>();
  for (const report of listed) sources.add(SOURCE_NAMES[report.source] ?? report.source);
  if (input.history.warnings.length) sources.add("National Weather Service active watches and warnings");
  sources.add("Damage probability model documented in HailMap (not a trained model)");

  const photos = (input.photos ?? []).flatMap((pin) =>
    pin.photos.flatMap((photo) => {
      if (!photo.photoUrl) return [];
      return [
        {
          url: photo.photoUrl,
          damageType: photo.damageType,
          note: photo.note,
          takenAt: photo.takenAt,
          pinStatus: pinStatusLabel(pin.status),
        },
      ];
    }),
  );

  const meshNote =
    input.meshStatus === "skipped" || input.meshStatus == null
      ? "Radar MESH is not included. Set HAILMAP_MESH_URL to ingest an official MESH feed."
      : input.meshStatus === "error"
        ? "The MESH feed was unavailable when this report was built."
        : input.meshStatus === "empty"
          ? "The MESH feed responded with no hail polygons in this window."
          : null;

  return {
    id: input.id ?? "",
    title: input.title,
    createdAt,
    kind: input.kind,
    place: {
      label: input.label,
      lat: input.lat,
      lon: input.lon,
      radiusKm: input.radiusKm,
      bounds: input.bounds,
    },
    hours: input.hours,
    score: input.history.score,
    stats: {
      reportCount: listed.length,
      maxHailIn: input.history.maxHailIn,
      maxWindMph: input.history.maxWindMph,
      strongestTornado: input.history.strongestTornado,
      nearestKm: input.history.nearestKm,
      swathHit: input.history.swathHit,
    },
    warnings: input.history.warnings,
    warningNote:
      input.history.warningStatus === "unavailable"
        ? "Active watches and warnings could not be checked."
        : input.history.warnings.length
          ? null
          : "No active severe watch or warning covers this point.",
    meshNote,
    timeline: listed.slice(0, 80).map((report) => ({
      id: report.id,
      hazard: hazardLabel(hazardOf(report.hazard)),
      magnitude: magnitudeLabel(report),
      when: report.occurredAt,
      where: whereOf(report),
      source: SOURCE_NAMES[report.source] ?? report.source,
      confidence: report.confidence,
      distanceKm: report.distanceKm ?? haversineKm(input.lat, input.lon, report.lat, report.lon),
      remark: report.remark,
    })),
    photos,
    sources: [...sources],
    svg: sketchMap(
      listed.map((report) => ({ lon: report.lon, lat: report.lat, hazard: hazardOf(report.hazard) })),
      { lon: input.lon, lat: input.lat },
      input.bounds,
    ),
    disclaimer:
      "Field photos and notes are user documentation. They are not National Weather Service reports. Damage probability is a transparent score from nearby official reports, not a roof inspection.",
  };
}

export function escapeSvgText(value: string): string {
  return esc(value);
}
