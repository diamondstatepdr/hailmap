import fs from "node:fs";
import path from "node:path";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { historyDir, selectHistoryNear } from "@/lib/history-db";
import { historyRowToReport } from "@/lib/history-query";
import { SBW_POLYGON_START } from "@/lib/history-coverage";
import { getMapReports, userAgent } from "@/lib/ingest";
import { convectiveDay } from "@/lib/parsers";
import { gapFor, hostOf, pace } from "@/lib/paced";
import { addIsoDays, isoDateUTC } from "@/lib/mesh-plan";
import { ensureDaily } from "@/lib/spc-archive";
import type { HailReport } from "@/lib/types";
import {
  activeWindow,
  convectiveWindow,
  geometryHitsBounds,
  replayFrames,
  stormTimeZone,
  type ReplayBounds,
} from "@/lib/replay-time";
import { warmReplayBaseline, warmReplayOpening } from "@/lib/replay-archive";

export interface ReplayWarningProps {
  id: string;
  kind: "warning";
  event: string;
  category: string;
  office: string;
  until: string;
  hazard: string;
  area: string;
  begin: string;
  end: string;
  fill: string;
  stroke: string;
  rank: number;
  mentionsHail: boolean;
  hailIn: number | null;
}

export interface ReplayManifest {
  date: string;
  timeZone: string;
  start: string;
  end: string;
  frames: string[];
  reports: HailReport[];
  warnings: FeatureCollection;
  warningNote: string | null;
  radarNote: string;
  bounds: ReplayBounds;
}

const WARNING_EVENTS: Record<string, { event: string; hazard: string; fill: string }> = {
  SV: { event: "Severe Thunderstorm Warning", hazard: "Thunderstorms", fill: "#ea580c" },
  TO: { event: "Tornado Warning", hazard: "Tornado", fill: "#dc2626" },
};

function warningFile(date: string): string {
  return path.join(historyDir(), "replay", `sbw-${date}.json`);
}

function asNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function warningFeatures(payload: unknown): Feature<Polygon | MultiPolygon, ReplayWarningProps>[] {
  const features = (payload as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const parsed: Feature<Polygon | MultiPolygon, ReplayWarningProps>[] = [];
  for (const feature of features) {
    if (!feature || typeof feature !== "object") continue;
    const item = feature as { id?: unknown; geometry?: Polygon | MultiPolygon; properties?: Record<string, unknown> };
    const props = item.properties ?? {};
    const code = String(props.phenomena ?? "");
    const significance = String(props.significance ?? "");
    const known = WARNING_EVENTS[code];
    if (!known || significance !== "W") continue;
    const geometry = item.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    const begin = String(props.polygon_begin || props.issue || "");
    const end = String(props.polygon_end || props.expire || "");
    if (!begin) continue;
    const hail = asNumber(props.hailtag);
    const id = String(item.id ?? `${props.wfo ?? ""}-${code}-${props.eventid ?? begin}`);
    parsed.push({
      type: "Feature",
      id,
      geometry,
      properties: {
        id,
        kind: "warning",
        event: known.event,
        category: "",
        office: String(props.wfo ?? ""),
        until: end,
        hazard: known.hazard,
        area: String(props.wfo ?? ""),
        begin,
        end,
        fill: known.fill,
        stroke: known.fill,
        rank: code === "TO" ? 40 : 30,
        mentionsHail: code === "SV" || hail != null,
        hailIn: hail,
      },
    });
  }
  return parsed;
}

async function warningsForDay(date: string): Promise<{ features: Feature<Polygon | MultiPolygon, ReplayWarningProps>[]; note: string | null }> {
  if (date < SBW_POLYGON_START) {
    return { features: [], note: "Storm-based warning polygons in this archive start in 2002. Reports still replay." };
  }
  const file = warningFile(date);
  const closed = Date.now() > Date.parse(`${addIsoDays(date, 1)}T18:00:00Z`);
  if (closed && fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { features?: Feature<Polygon | MultiPolygon, ReplayWarningProps>[] };
      return { features: parsed.features ?? [], note: null };
    } catch {
      // Read the archive again.
    }
  }
  const window = convectiveWindow(date);
  const url = `https://mesonet.agron.iastate.edu/geojson/sbw.py?sts=${encodeURIComponent(window.start)}&ets=${encodeURIComponent(window.end)}`;
  try {
    const payload = await pace(hostOf(url), gapFor(url), async () => {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent(), Accept: "application/geo+json,application/json" },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    });
    const features = warningFeatures(payload);
    if (closed) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify({ features }));
      fs.renameSync(temporary, file);
    }
    return {
      features,
      note: features.length ? null : "No severe thunderstorm or tornado warning polygons were archived for this day.",
    };
  } catch (error) {
    console.error("[hailmap] replay warnings", error instanceof Error ? error.message : error);
    return { features: [], note: "Archived warning polygons could not be loaded. Reports still replay." };
  }
}

async function liveReports(date: string, bounds: ReplayBounds): Promise<HailReport[]> {
  const today = isoDateUTC(new Date());
  if (date < addIsoDays(today, -8)) return [];
  const map = await getMapReports();
  return map.reports.filter((report) => {
    if (report.source === "seed") return false;
    if (report.lat < bounds.south || report.lat > bounds.north || report.lon < bounds.west || report.lon > bounds.east) return false;
    const time = Date.parse(report.occurredAt);
    if (!Number.isFinite(time)) return false;
    return convectiveDay(new Date(time)) === date;
  });
}

function dedupeReports(rows: HailReport[]): HailReport[] {
  const seen = new Set<string>();
  const kept: HailReport[] = [];
  for (const report of rows) {
    const key = `${report.hazard}|${report.occurredAt.slice(0, 16)}|${report.lat.toFixed(2)}|${report.lon.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(report);
  }
  kept.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  return kept.slice(0, 5000);
}

export async function replayManifest(input: { date: string; bounds: ReplayBounds; now?: Date }): Promise<ReplayManifest> {
  const now = input.now ?? new Date();
  const today = isoDateUTC(now);
  if (input.date > today) throw new Error("That day has not happened yet.");
  warmReplayBaseline(input.date);
  await ensureDaily(input.date, now);
  const archived = selectHistoryNear({ start: input.date, end: input.date }, input.bounds).map((row) => historyRowToReport(row));
  const live = await liveReports(input.date, input.bounds);
  const reports = dedupeReports([...live, ...archived]);
  const warningResult = await warningsForDay(input.date);
  const warnings = warningResult.features.filter((feature) => geometryHitsBounds(feature.geometry, input.bounds));
  const window = convectiveWindow(input.date, now);
  const times = [
    ...reports.map((report) => Date.parse(report.occurredAt)),
    ...warnings.flatMap((feature) => [Date.parse(feature.properties.begin), Date.parse(feature.properties.end)]),
  ];
  const span = activeWindow(times, window);
  const frames = replayFrames(span.start, span.end, 15);
  warmReplayOpening(input.date, frames);
  const timeZone = stormTimeZone((input.bounds.west + input.bounds.east) / 2);
  return {
    date: input.date,
    timeZone,
    start: span.start,
    end: span.end,
    frames,
    reports,
    warnings: { type: "FeatureCollection", features: warnings },
    warningNote: warnings.length ? null : warningResult.note,
    radarNote: "Play to build the MRMS hail swath. Spotter reports and warning polygons appear at their times.",
    bounds: input.bounds,
  };
}
