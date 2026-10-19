import {
  alertCopy,
  alertLink,
  matchAreas,
  meshCandidates,
  reportCandidates,
  type HailCandidate,
  type WatchTarget,
} from "@/lib/alert-match";
import { stateName } from "@/lib/alert-model";
import { userAgent } from "@/lib/ingest";
import { meshLayerFor } from "@/lib/mesh-cache";
import { addIsoDays, isIsoDate, planMesh } from "@/lib/mesh-plan";
import { parseIemGeoJson, parseSpcHailCsv, spcFileStamp } from "@/lib/parsers";
import { intersectsState, stateLabel, stateOf } from "@/lib/state-locate";
import { haversineKm } from "@/lib/geo";
import type { ReportPoint } from "@/lib/alert-match";

export interface ReplayAlert {
  kind: HailCandidate["kind"];
  stormKey: string;
  place: string;
  sizeIn: number | null;
  occurredAt: string;
  lat: number;
  lon: number;
  title: string;
  body: string;
  url: string;
}

export interface ReplayAreaResult {
  label: string;
  kind: WatchTarget["kind"];
  alerts: ReplayAlert[];
}

export interface ReplayResult {
  date: string;
  mesh: { status: string; swaths: number; validTime: string | null; note: string | null };
  reports: number;
  areas: ReplayAreaResult[];
}

async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: "text/csv,text/plain,*/*" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return null;
  return response.text();
}

async function fetchJson(url: string): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/geo+json, application/json" },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) return null;
  return response.json();
}

function inWindow(iso: string, startMs: number, endMs: number): boolean {
  const time = Date.parse(iso);
  return Number.isFinite(time) && time >= startMs && time < endMs;
}

/**
 * What the alert engine would have sent for one convective day.
 * Does not send pushes or write inbox rows.
 */
export async function replayHailDay(input: {
  date: string;
  lat?: number | null;
  lon?: number | null;
  radiusMi?: number;
  state?: string | null;
  minSizeIn?: number;
}): Promise<ReplayResult | { error: string }> {
  if (!isIsoDate(input.date)) return { error: "date must be YYYY-MM-DD" };
  const plan = planMesh({ date: input.date, now: new Date(`${addIsoDays(input.date, 2)}T18:00:00Z`) });
  if ("error" in plan) return plan;

  const startMs = Date.parse(`${input.date}T12:00:00Z`);
  const endMs = Date.parse(`${addIsoDays(input.date, 1)}T12:00:00Z`);
  const stamp = spcFileStamp(input.date);
  const iemStart = `${input.date.replace(/-/g, "")}1200`;
  const iemEnd = `${addIsoDays(input.date, 1).replace(/-/g, "")}1200`;
  const [spcCsv, iemPayload, layer] = await Promise.all([
    fetchText(`https://www.spc.noaa.gov/climo/reports/${stamp}_rpts_hail.csv`),
    fetchJson(`https://mesonet.agron.iastate.edu/geojson/lsr.py?sts=${iemStart}&ets=${iemEnd}`),
    meshLayerFor(plan, new Date(`${addIsoDays(input.date, 2)}T18:00:00Z`)),
  ]);

  const spc = spcCsv ? parseSpcHailCsv(spcCsv, input.date) : [];
  const iem = iemPayload ? parseIemGeoJson(iemPayload).filter((report) => report.hazard === "hail") : [];
  const reports: ReportPoint[] = [...spc, ...iem]
    .filter((report) => report.hazard === "hail" && report.sizeIn != null && inWindow(report.occurredAt, startMs, endMs))
    .map((report) => ({
      id: `${report.source}:${report.externalId}`,
      lat: report.lat,
      lon: report.lon,
      sizeIn: report.sizeIn,
      occurredAt: report.occurredAt,
      location: report.location,
      state: report.state,
    }));

  const placeFor = (lat: number, lon: number) => {
    let best: ReportPoint | null = null;
    let bestKm = 80;
    for (const report of reports) {
      const km = haversineKm(lat, lon, report.lat, report.lon);
      if (km < bestKm) {
        best = report;
        bestKm = km;
      }
    }
    if (best?.location) return [best.location, best.state].filter(Boolean).join(", ");
    const code = stateOf(lat, lon);
    return code ? stateLabel(code) : "United States";
  };

  const occurredAt = layer.validTime ?? `${input.date}T23:00:00Z`;
  const candidates = [
    ...meshCandidates(layer.collection, occurredAt, placeFor),
    ...reportCandidates(reports),
  ];
  const minSizeIn = input.minSizeIn ?? 0;
  const areas: WatchTarget[] = [];
  if (input.lat != null && input.lon != null) {
    areas.push({
      id: "replay-point",
      kind: "point",
      label: `${input.radiusMi ?? 25} mi watch`,
      lat: input.lat,
      lon: input.lon,
      radiusMi: input.radiusMi ?? 25,
      state: null,
      minSizeIn,
      mesh: true,
      reports: true,
      warnings: false,
      outlook: false,
    });
  }
  if (input.state) {
    const code = input.state.toUpperCase();
    areas.push({
      id: "replay-state",
      kind: "state",
      label: stateName(code),
      lat: null,
      lon: null,
      radiusMi: 0,
      state: code,
      minSizeIn,
      mesh: true,
      reports: true,
      warnings: false,
      outlook: false,
    });
  }

  const hits = matchAreas(areas, candidates, { stateOf, intersects: intersectsState });
  const grouped = new Map<string, ReplayAreaResult>();
  for (const area of areas) {
    grouped.set(area.id, { label: area.label, kind: area.kind, alerts: [] });
  }
  for (const hit of hits) {
    const copy = alertCopy(hit.candidate, "America/Chicago");
    grouped.get(hit.area.id)?.alerts.push({
      kind: hit.candidate.kind,
      stormKey: hit.candidate.stormKey,
      place: hit.candidate.place,
      sizeIn: hit.candidate.sizeIn,
      occurredAt: hit.candidate.occurredAt,
      lat: hit.candidate.lat,
      lon: hit.candidate.lon,
      title: copy.title,
      body: copy.body,
      url: alertLink(hit.candidate, hit.area),
    });
  }

  return {
    date: input.date,
    mesh: {
      status: layer.status,
      swaths: layer.collection.features.filter((feature) => Number(feature.properties?.minIn) === 0.75).length,
      validTime: layer.validTime,
      note: layer.note,
    },
    reports: reports.length,
    areas: [...grouped.values()],
  };
}
