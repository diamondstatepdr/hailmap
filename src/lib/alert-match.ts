import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  bucketCoord,
  formatAlertClock,
  formatInches,
  MILES_TO_KM,
  type WatchKind,
} from "@/lib/alert-model";
import { haversineKm, pointInGeometry } from "@/lib/geo";
import { convectiveDay } from "@/lib/parsers";
import type { ThreatProperties } from "@/lib/threats";

export interface WatchTarget {
  id: string;
  kind: WatchKind;
  label: string;
  lat: number | null;
  lon: number | null;
  radiusMi: number;
  state: string | null;
  minSizeIn: number;
  mesh: boolean;
  reports: boolean;
  warnings: boolean;
  outlook: boolean;
}

export interface HailCandidate {
  kind: "mesh" | "report" | "warning" | "outlook";
  stormKey: string;
  lat: number;
  lon: number;
  sizeIn: number | null;
  /** False when the size is inferred (a severe thunderstorm warning with no stated size). */
  sizeKnown: boolean;
  place: string;
  occurredAt: string;
  points: Array<{ lat: number; lon: number }>;
  geometry: Polygon | MultiPolygon | null;
  reportId: string | null;
  detail: string;
}

export interface StateLocate {
  stateOf(lat: number, lon: number): string | null;
  intersects(code: string, geometry: Polygon | MultiPolygon): boolean;
}

export interface ReportPoint {
  id: string;
  lat: number;
  lon: number;
  sizeIn: number | null;
  occurredAt: string;
  location: string | null;
  state: string | null;
}

const WARNING_EVENTS = new Set(["Severe Thunderstorm Warning", "Tornado Warning"]);

export function geometryCenter(geometry: Polygon | MultiPolygon): { lat: number; lon: number } | null {
  const ring = geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!ring?.length) return null;
  let lon = 0;
  let lat = 0;
  let count = 0;
  for (const pair of ring) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    lon += Number(pair[0]);
    lat += Number(pair[1]);
    count += 1;
  }
  if (!count) return null;
  return { lon: lon / count, lat: lat / count };
}

function sampleGeometry(geometry: Polygon | MultiPolygon, center: { lat: number; lon: number }): Array<{ lat: number; lon: number }> {
  const points = [{ lat: center.lat, lon: center.lon }];
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring) continue;
    const step = Math.max(1, Math.ceil(ring.length / 80));
    for (let index = 0; index < ring.length; index += step) {
      const pair = ring[index];
      if (!pair || pair.length < 2) continue;
      points.push({ lon: Number(pair[0]), lat: Number(pair[1]) });
      const next = ring[Math.min(ring.length - 1, index + Math.floor(step / 2))] ?? pair;
      if (next.length >= 2) {
        points.push({ lon: (Number(pair[0]) + Number(next[0])) / 2, lat: (Number(pair[1]) + Number(next[1])) / 2 });
      }
    }
  }
  return points;
}

function asPolygon(geometry: GeoJSON.Geometry | null | undefined): Polygon | MultiPolygon | null {
  if (!geometry) return null;
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return geometry;
  return null;
}

export function meshCandidates(
  collection: FeatureCollection,
  occurredAt: string,
  placeFor: (lat: number, lon: number) => string,
): HailCandidate[] {
  const when = occurredAt || new Date().toISOString();
  const day = convectiveDay(new Date(when));
  const byStorm = new Map<string, HailCandidate>();
  for (const feature of collection.features) {
    const props = (feature.properties ?? {}) as { minIn?: number; maxIn?: number };
    if (Number(props.minIn) !== 0.75) continue;
    const geometry = asPolygon(feature.geometry);
    if (!geometry) continue;
    const center = geometryCenter(geometry);
    if (!center) continue;
    const sizeIn = Number.isFinite(Number(props.maxIn)) ? Number(props.maxIn) : 0.75;
    const stormKey = `mesh:${day}:${bucketCoord(center.lat)}:${bucketCoord(center.lon)}`;
    const points = sampleGeometry(geometry, center);
    const existing = byStorm.get(stormKey);
    if (!existing) {
      byStorm.set(stormKey, {
        kind: "mesh",
        stormKey,
        lat: center.lat,
        lon: center.lon,
        sizeIn,
        sizeKnown: true,
        place: placeFor(center.lat, center.lon),
        occurredAt: when,
        points,
        geometry,
        reportId: null,
        detail: "Radar hail",
      });
      continue;
    }
    existing.points.push(...points);
    if (sizeIn > (existing.sizeIn ?? 0)) {
      existing.sizeIn = sizeIn;
      existing.lat = center.lat;
      existing.lon = center.lon;
      existing.place = placeFor(center.lat, center.lon);
      existing.geometry = geometry;
    }
  }
  return [...byStorm.values()];
}

export function reportCandidates(reports: ReportPoint[]): HailCandidate[] {
  const groups = new Map<string, ReportPoint[]>();
  for (const report of reports) {
    if (report.sizeIn == null || report.sizeIn <= 0) continue;
    const when = new Date(report.occurredAt);
    if (Number.isNaN(when.getTime())) continue;
    const key = `report:${convectiveDay(when)}:${bucketCoord(report.lat)}:${bucketCoord(report.lon)}`;
    const list = groups.get(key) ?? [];
    list.push(report);
    groups.set(key, list);
  }
  const candidates: HailCandidate[] = [];
  for (const [stormKey, list] of groups) {
    const peak = list.reduce((best, item) => ((item.sizeIn ?? 0) > (best.sizeIn ?? 0) ? item : best));
    const place = [peak.location, peak.state].filter(Boolean).join(", ") || `${peak.lat.toFixed(2)}, ${peak.lon.toFixed(2)}`;
    candidates.push({
      kind: "report",
      stormKey,
      lat: peak.lat,
      lon: peak.lon,
      sizeIn: peak.sizeIn,
      sizeKnown: true,
      place,
      occurredAt: peak.occurredAt,
      points: list.map((item) => ({ lat: item.lat, lon: item.lon })),
      geometry: null,
      reportId: peak.id,
      detail: "Spotter report",
    });
  }
  return candidates;
}

export function warningCandidates(features: Array<Feature<Polygon | MultiPolygon, ThreatProperties>>, now: Date): HailCandidate[] {
  const candidates: HailCandidate[] = [];
  for (const feature of features) {
    const props = feature.properties;
    if (props.kind !== "warning" || !WARNING_EVENTS.has(props.event) || !props.mentionsHail) continue;
    const geometry = asPolygon(feature.geometry);
    if (!geometry) continue;
    const center = geometryCenter(geometry);
    if (!center) continue;
    const stated = props.hailIn;
    const assumed = stated == null && props.event === "Severe Thunderstorm Warning";
    candidates.push({
      kind: "warning",
      stormKey: `warning:${props.id}`,
      lat: center.lat,
      lon: center.lon,
      sizeIn: stated ?? (assumed ? 1 : null),
      sizeKnown: stated != null,
      place: props.area || props.event,
      occurredAt: now.toISOString(),
      points: sampleGeometry(geometry, center),
      geometry,
      reportId: null,
      detail: props.event,
    });
  }
  return candidates;
}

export function outlookCandidates(features: Array<Feature<Polygon | MultiPolygon, ThreatProperties>>, now: Date): HailCandidate[] {
  const day = convectiveDay(now);
  const candidates: HailCandidate[] = [];
  for (const feature of features) {
    const props = feature.properties;
    const outlook = props.kind === "outlook" || (props.kind === "significant" && props.mentionsHail);
    if (!outlook || !props.mentionsHail) continue;
    const geometry = asPolygon(feature.geometry);
    if (!geometry) continue;
    const center = geometryCenter(geometry);
    if (!center) continue;
    const significant = props.kind === "significant";
    candidates.push({
      kind: "outlook",
      stormKey: `outlook:${day}`,
      lat: center.lat,
      lon: center.lon,
      sizeIn: significant ? 2 : props.hailIn,
      sizeKnown: false,
      place: significant ? "Significant hail area" : props.event,
      occurredAt: now.toISOString(),
      points: sampleGeometry(geometry, center),
      geometry,
      reportId: null,
      detail: props.event,
    });
  }
  return candidates;
}

function kindEnabled(area: WatchTarget, kind: HailCandidate["kind"]): boolean {
  if (kind === "mesh") return area.mesh;
  if (kind === "report") return area.reports;
  if (kind === "warning") return area.warnings;
  return area.outlook;
}

function passesThreshold(area: WatchTarget, candidate: HailCandidate): boolean {
  if (area.minSizeIn <= 0) return true;
  if (candidate.sizeIn == null) return false;
  return candidate.sizeIn + 1e-9 >= area.minSizeIn;
}

function nearPoint(lat: number, lon: number, points: Array<{ lat: number; lon: number }>, radiusKm: number): boolean {
  return points.some((point) => haversineKm(lat, lon, point.lat, point.lon) <= radiusKm);
}

function covers(area: WatchTarget, candidate: HailCandidate, locate: StateLocate): boolean {
  if (area.kind === "state") {
    const code = area.state?.toUpperCase();
    if (!code) return false;
    if (candidate.points.some((point) => locate.stateOf(point.lat, point.lon) === code)) return true;
    if (candidate.geometry && locate.intersects(code, candidate.geometry)) return true;
    return false;
  }
  if (area.lat == null || area.lon == null) return false;
  const radiusKm = area.radiusMi * MILES_TO_KM;
  if (nearPoint(area.lat, area.lon, candidate.points, radiusKm)) return true;
  if (candidate.geometry && pointInGeometry(area.lon, area.lat, candidate.geometry)) return true;
  if (candidate.geometry && nearPoint(area.lat, area.lon, sampleGeometry(candidate.geometry, { lat: candidate.lat, lon: candidate.lon }), radiusKm)) {
    return true;
  }
  return false;
}

export interface AreaHit {
  area: WatchTarget;
  candidate: HailCandidate;
}

/** One match per storm cell per area. Outlooks collapse to the strongest heads-up for the day. */
export function matchAreas(areas: WatchTarget[], candidates: HailCandidate[], locate: StateLocate): AreaHit[] {
  const hits: AreaHit[] = [];
  for (const area of areas) {
    let bestOutlook: HailCandidate | null = null;
    for (const candidate of candidates) {
      if (!kindEnabled(area, candidate.kind) || !passesThreshold(area, candidate) || !covers(area, candidate, locate)) {
        continue;
      }
      if (candidate.kind === "outlook") {
        if (!bestOutlook || (candidate.sizeIn ?? 0) > (bestOutlook.sizeIn ?? 0)) bestOutlook = candidate;
        continue;
      }
      hits.push({ area, candidate });
    }
    if (bestOutlook) hits.push({ area, candidate: bestOutlook });
  }
  return hits;
}

export function alertCopy(candidate: HailCandidate, timeZone: string): { title: string; body: string } {
  const clock = formatAlertClock(candidate.occurredAt, timeZone);
  if (candidate.kind === "outlook") {
    const headline = (candidate.sizeIn ?? 0) >= 2 ? '2"+ hail possible' : "Hail possible";
    return { title: `${headline} · ${candidate.place}`, body: `SPC outlook · ${clock}` };
  }
  const size = candidate.sizeKnown && candidate.sizeIn != null ? `${formatInches(candidate.sizeIn)} hail` : "Hail";
  const source =
    candidate.kind === "mesh" ? "Radar" : candidate.kind === "report" ? "Spotter report" : candidate.detail || "NWS warning";
  return {
    title: `${size} · ${candidate.place}`,
    body: `${source} · ${clock}`,
  };
}

export function alertLink(candidate: HailCandidate, area: WatchTarget): string {
  const params = new URLSearchParams();
  params.set("focusLat", candidate.lat.toFixed(4));
  params.set("focusLon", candidate.lon.toFixed(4));
  params.set("focusZoom", area.kind === "state" ? "7" : "10");
  if (candidate.reportId) params.set("reportId", candidate.reportId);
  if (area.kind === "point" && area.lat != null && area.lon != null) {
    params.set("card", "address");
    params.set("cardLat", area.lat.toFixed(5));
    params.set("cardLon", area.lon.toFixed(5));
    params.set("cardLabel", area.label.slice(0, 80));
  }
  return `/?${params.toString()}`;
}
