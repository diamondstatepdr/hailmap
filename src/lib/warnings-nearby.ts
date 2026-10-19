import { haversineKm, pointInGeometry } from "@/lib/geo";
import { userAgent } from "@/lib/ingest";

export interface NearbyWarning {
  id: string;
  event: string;
  kind: "warning" | "watch" | "statement";
  issued: string | null;
  until: string | null;
  office: string | null;
  area: string | null;
}

interface IemEvent {
  issue?: string;
  expire?: string;
  eventid?: number;
  phenomena?: string;
  significance?: string;
  wfo?: string;
  name?: string;
  ugc?: string;
}

const KIND: Record<string, NearbyWarning["kind"]> = {
  W: "warning",
  A: "watch",
  S: "statement",
};

const memory = new Map<string, { at: number; warnings: NearbyWarning[] }>();

export function warningsFromIem(events: IemEvent[]): NearbyWarning[] {
  const warnings: NearbyWarning[] = [];
  for (const event of events) {
    const phenomena = String(event.phenomena ?? "");
    if (phenomena !== "SV" && phenomena !== "TO") continue;
    const kind = KIND[String(event.significance ?? "")];
    if (!kind) continue;
    const name = String(event.name ?? "").trim();
    if (!name) continue;
    const issued = event.issue ? String(event.issue) : null;
    const id = `${event.wfo ?? ""}-${phenomena}-${event.significance ?? ""}-${event.eventid ?? issued ?? name}`;
    warnings.push({
      id,
      event: name,
      kind,
      issued,
      until: event.expire ? String(event.expire) : null,
      office: event.wfo ? String(event.wfo) : null,
      area: event.ugc ? String(event.ugc) : null,
    });
  }
  return warnings;
}

export function warningsFromThreats(
  collection: GeoJSON.FeatureCollection | null | undefined,
  lat: number,
  lon: number,
): NearbyWarning[] {
  const warnings: NearbyWarning[] = [];
  for (const feature of collection?.features ?? []) {
    const props = feature.properties ?? {};
    const kind = String(props.kind ?? "");
    if (kind !== "warning" && kind !== "watch" && kind !== "statement") continue;
    const event = String(props.event ?? "");
    if (!/tornado|severe thunderstorm|special weather statement/i.test(event)) continue;
    const covers = pointInGeometry(lon, lat, feature.geometry);
    let near = covers;
    if (!near && feature.geometry && (feature.geometry.type === "Polygon" || feature.geometry.type === "MultiPolygon")) {
      const ring = feature.geometry.type === "Polygon" ? feature.geometry.coordinates[0] : feature.geometry.coordinates[0]?.[0];
      if (ring?.length) {
        let sumLat = 0;
        let sumLon = 0;
        for (const [ringLon, ringLat] of ring) {
          sumLon += ringLon;
          sumLat += ringLat;
        }
        near = haversineKm(lat, lon, sumLat / ring.length, sumLon / ring.length) <= 50;
      }
    }
    if (!near) continue;
    warnings.push({
      id: String(props.id ?? `${event}-${props.until ?? ""}`),
      event,
      kind,
      issued: null,
      until: props.until ? String(props.until) : null,
      office: props.office ? String(props.office) : null,
      area: props.area ? String(props.area) : null,
    });
  }
  return warnings;
}

function overlaps(warning: NearbyWarning, startMs: number, endMs: number): boolean {
  const issued = warning.issued ? Date.parse(warning.issued) : null;
  const until = warning.until ? Date.parse(warning.until) : null;
  if (issued == null && until == null) return true;
  const begin = issued ?? until ?? startMs;
  const finish = until ?? issued ?? endMs;
  return begin <= endMs && finish >= startMs;
}

export function mergeWarnings(groups: NearbyWarning[][], startMs: number, endMs: number): NearbyWarning[] {
  const seen = new Set<string>();
  const merged: NearbyWarning[] = [];
  for (const group of groups) {
    for (const warning of group) {
      if (!overlaps(warning, startMs, endMs)) continue;
      const key = `${warning.event}|${warning.issued ?? ""}|${warning.office ?? ""}|${warning.area ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(warning);
    }
  }
  merged.sort((a, b) => Date.parse(b.issued ?? b.until ?? "0") - Date.parse(a.issued ?? a.until ?? "0"));
  return merged.slice(0, 40);
}

async function fetchIem(lat: number, lon: number, startDate: string, endDate: string): Promise<NearbyWarning[]> {
  const url = `https://mesonet.agron.iastate.edu/json/vtec_events_bypoint.py?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&sdate=${startDate}&edate=${endDate}`;
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as { events?: IemEvent[] };
  return warningsFromIem(payload.events ?? []);
}

export async function nearbyWarnings(input: {
  lat: number;
  lon: number;
  startIso: string;
  endIso: string;
  threats?: GeoJSON.FeatureCollection | null;
}): Promise<{ status: "ok" | "partial" | "unavailable"; warnings: NearbyWarning[] }> {
  const startMs = Date.parse(input.startIso);
  const endMs = Date.parse(input.endIso);
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const endDate = new Date(endMs).toISOString().slice(0, 10);
  const cacheKey = `${input.lat.toFixed(1)},${input.lon.toFixed(1)},${startDate},${endDate}`;
  const cached = memory.get(cacheKey);
  let historical: NearbyWarning[] = [];
  let status: "ok" | "partial" | "unavailable" = "ok";
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
    historical = cached.warnings;
  } else {
    const offsets: Array<[number, number]> = [
      [0, 0],
      [0.28, 0],
      [-0.28, 0],
      [0, 0.35],
      [0, -0.35],
    ];
    const batches = await Promise.all(
      offsets.map(async ([dLat, dLon]) => {
        try {
          return await fetchIem(input.lat + dLat, input.lon + dLon, startDate, endDate);
        } catch (error) {
          console.error("[hailmap] warnings", error instanceof Error ? error.message : error);
          return null;
        }
      }),
    );
    if (batches.every((batch) => batch == null)) status = "unavailable";
    else if (batches.some((batch) => batch == null)) status = "partial";
    historical = batches.flatMap((batch) => batch ?? []);
    if (status !== "unavailable") memory.set(cacheKey, { at: Date.now(), warnings: historical });
  }
  const active = warningsFromThreats(input.threats, input.lat, input.lon);
  return { status, warnings: mergeWarnings([historical, active], startMs, endMs) };
}
