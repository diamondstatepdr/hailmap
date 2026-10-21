import { createHash, randomUUID } from "node:crypto";
import { pinsInBounds, pinsInRadius, saveStormReport, listStormReports, takeActionSlot } from "@/lib/accounts";
import { readSession } from "@/lib/auth";
import { TIME_WINDOWS } from "@/lib/filters";
import { haversineKm, validLatLon } from "@/lib/geo";
import { getMapReports } from "@/lib/ingest";
import { getLiveThreats } from "@/lib/live-threats";
import { renderReportSnapshot } from "@/lib/map-snapshot";
import { radarSampleFor, radarSwathsNear } from "@/lib/mesh-cache";
import { planMesh } from "@/lib/mesh-plan";
import { buildPlaceHistory, swathEvidence } from "@/lib/place";
import { buildAddressHistory, lossCandidates } from "@/lib/history-place";
import { historyRowToReport } from "@/lib/history-query";
import { daysInSpan, parseSpan, spanLabel } from "@/lib/history-range";
import { selectHistory } from "@/lib/history-db";
import { ensureDailySpan, ensureHistoryIndex } from "@/lib/spc-archive";
import { buildStormReport } from "@/lib/storm-report";
import { mergeWarnings, nearbyWarnings, warningsFromThreats } from "@/lib/warnings-nearby";
import { clientIp } from "@/lib/photos";
import type { HailReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_HOURS = new Set(TIME_WINDOWS.map((item) => item.hours));

interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

function asBounds(value: unknown): Bounds | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const bounds = {
    west: Number(row.west),
    south: Number(row.south),
    east: Number(row.east),
    north: Number(row.north),
  };
  if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)) return null;
  if (bounds.west >= bounds.east || bounds.south >= bounds.north) return null;
  if (bounds.north > 90 || bounds.south < -90 || bounds.west < -180 || bounds.east > 180) return null;
  return bounds;
}

function inBounds(report: HailReport, bounds: Bounds): boolean {
  return report.lon >= bounds.west && report.lon <= bounds.east && report.lat >= bounds.south && report.lat <= bounds.north;
}

export async function GET(request: Request) {
  const user = readSession(request);
  if (!user) return Response.json({ reports: [] });
  return Response.json({ reports: listStormReports(user.id) });
}

export async function POST(request: Request) {
  const hash = createHash("sha256").update(`hailmap-report|${clientIp(request)}`).digest("hex");
  const slot = takeActionSlot(hash, "storm-report", 30, 3600000);
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const historySpan = typeof record.start === "string" && typeof record.end === "string" ? parseSpan(record.start, record.end) : null;
  if (historySpan && "error" in historySpan) return Response.json({ error: historySpan.error }, { status: 400 });
  const hours = Number(record.hours ?? 168);
  if (!historySpan && !WINDOW_HOURS.has(hours)) return Response.json({ error: "hours must be a map time window" }, { status: 400 });
  const scoreDate = typeof record.scoreDate === "string" ? record.scoreDate : null;
  const bounds = asBounds(record.bounds);
  const lat = Number(record.lat);
  const lon = Number(record.lon);
  const label = String(record.label ?? "").trim().slice(0, 160);
  if (!label) return Response.json({ error: "A label is required" }, { status: 400 });

  let centerLat = lat;
  let centerLon = lon;
  let radiusKm = Number(record.radiusKm ?? 15);
  let kind: "address" | "area" = "address";
  if (bounds) {
    kind = "area";
    centerLat = (bounds.south + bounds.north) / 2;
    centerLon = (bounds.west + bounds.east) / 2;
    radiusKm = Math.min(80, Math.max(haversineKm(centerLat, centerLon, bounds.north, bounds.east), 1));
    if (haversineKm(bounds.south, bounds.west, bounds.north, bounds.east) > 800) {
      return Response.json({ error: "Choose a smaller area (under 800 km across)." }, { status: 400 });
    }
  } else if (!validLatLon(lat, lon)) {
    return Response.json({ error: "Provide an address point or map bounds" }, { status: 400 });
  } else if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 80) {
    return Response.json({ error: "radiusKm must be between 1 and 80" }, { status: 400 });
  }

  try {
    if (historySpan && kind === "address") {
      const built = await buildAddressHistory({
        lat: centerLat,
        lon: centerLon,
        radiusKm,
        span: historySpan,
        scoreDate,
      });
      const candidates = lossCandidates(built.events).slice(0, 40);
      const listed = built.events.flatMap((event) => event.reports).slice(0, 120);
      const meshDays = built.events
        .filter((event) => event.meshStatus === "ok" || event.meshStatus === "empty")
        .slice(0, 40)
        .map((event) => ({
          date: event.date,
          label: event.label,
          maxIn: event.meshMaxIn,
          validTime: null,
          product: "MESH_Max_1440min",
          status: event.meshMaxIn == null ? ("empty" as const) : ("ok" as const),
        }));
      const id = randomUUID();
      const document = buildStormReport({
        id,
        title: label,
        kind,
        label,
        lat: centerLat,
        lon: centerLon,
        radiusKm,
        bounds: null,
        hours: daysInSpan(historySpan) * 24,
        rangeLabel: spanLabel(historySpan),
        rangeStart: historySpan.start,
        rangeEnd: historySpan.end,
        scoreDate: built.selectedDate ? built.events.find((event) => event.date === built.selectedDate)?.label ?? built.selectedDate : null,
        lossCandidates: candidates.map((event) => ({
          date: event.date,
          label: event.label,
          spotterMaxIn: event.spotterMaxIn,
          meshMaxIn: event.meshMaxIn,
          windMaxMph: event.windMaxMph,
          tornado: event.tornado,
          hailCount: event.hailCount,
          windCount: event.windCount,
          tornadoCount: event.tornadoCount,
        })),
        history: built.history,
        listed,
        radar: {
          maxIn: built.history.score ? built.events.find((event) => event.date === built.selectedDate)?.meshMaxIn ?? null : null,
          days: meshDays,
          note: "Radar hail at this point for hail dates in the span. Past days are cached. Days still marked pending fill in on the next report.",
        },
        nearbyWarnings: built.events.flatMap((event) => event.warnings).slice(0, 80),
        nearbyWarningNote: built.warningNote,
        snapshotSvg: null,
      });
      saveStormReport(readSession(request)?.id ?? null, label, document, id);
      return Response.json({ report: document, url: `/reports/${id}` }, { status: 201 });
    }
    if (historySpan && kind === "area" && bounds) {
      await ensureHistoryIndex();
      await ensureDailySpan(historySpan.start, historySpan.end, 12);
      const rows = selectHistory(historySpan, bounds, "", 400);
      const listed = rows.map((row) => historyRowToReport(row));
      const newestDate = rows.reduce((max, row) => (row.stormDate > max ? row.stormDate : max), "");
      const dayRows = newestDate ? rows.filter((row) => row.stormDate === newestDate) : rows;
      const newestMs = dayRows.reduce((max, row) => Math.max(max, Date.parse(row.occurredAt) || 0), 0);
      const history = buildPlaceHistory({
        lat: centerLat,
        lon: centerLon,
        radiusKm,
        hours: 36,
        now: newestMs > 0 ? newestMs + 3 * 3600 * 1000 : Date.now(),
        reports: dayRows.map((row) => historyRowToReport(row)),
        warningStatus: "unavailable",
      });
      const id = randomUUID();
      const document = buildStormReport({
        id,
        title: label,
        kind,
        label,
        lat: centerLat,
        lon: centerLon,
        radiusKm: null,
        bounds,
        hours: daysInSpan(historySpan) * 24,
        rangeLabel: spanLabel(historySpan),
        rangeStart: historySpan.start,
        rangeEnd: historySpan.end,
        scoreDate: newestDate || null,
        history,
        listed,
        nearbyWarnings: [],
        nearbyWarningNote: "Warning polygons are listed on address reports.",
      });
      saveStormReport(readSession(request)?.id ?? null, label, document, id);
      return Response.json({ report: document, url: `/reports/${id}` }, { status: 201 });
    }
    const now = Date.now();
    const plan = planMesh({ hours, now: new Date(now) });
    const radarPlan = "error" in plan ? null : plan;
    const [map, threats, radar, historyWarnings] = await Promise.all([
      getMapReports({ fresh: hours <= 1 }),
      getLiveThreats().catch(() => null),
      radarPlan
        ? radarSampleFor(radarPlan, centerLat, centerLon, new Date(now)).catch((error) => {
            console.error("[hailmap] report mesh", error instanceof Error ? error.message : error);
            return null;
          })
        : Promise.resolve(null),
      nearbyWarnings({
        lat: centerLat,
        lon: centerLon,
        startIso: new Date(now - hours * 3600 * 1000).toISOString(),
        endIso: new Date(now).toISOString(),
        threats: null,
      }).catch(() => null),
    ]);
    const cutoff = now - hours * 3600 * 1000;
    const windowReports = map.reports.filter((report) => {
      const time = Date.parse(report.occurredAt);
      return !Number.isNaN(time) && time >= cutoff;
    });
    const swath = swathEvidence(centerLat, centerLon, windowReports);
    const pool =
      kind === "area"
        ? windowReports.filter((report) => inBounds(report, bounds as Bounds))
        : windowReports;
    const history = buildPlaceHistory({
      lat: centerLat,
      lon: centerLon,
      radiusKm,
      hours,
      now,
      reports: pool,
      warnings: threats?.collection ?? null,
      warningStatus: threats && threats.status.nws !== "error" ? "ok" : "unavailable",
      swath,
      radarMaxIn: radar?.maxIn ?? null,
    });
    const swathFeatures = radarPlan
      ? await radarSwathsNear(radarPlan, centerLat, centerLon, new Date(now)).catch(() => null)
      : null;
    const listedForMap =
      kind === "area"
        ? pool.map((report) => ({ lon: report.lon, lat: report.lat, hazard: report.hazard }))
        : history.reports.map((report) => ({ lon: report.lon, lat: report.lat, hazard: report.hazard }));
    const snapshotSvg = await renderReportSnapshot({
      lat: centerLat,
      lon: centerLon,
      reports: listedForMap,
      swaths: swathFeatures?.features ?? [],
    }).catch(() => null);
    const windowStart = now - hours * 3600 * 1000;
    const historical = historyWarnings?.warnings ?? [];
    const active = warningsFromThreats(threats?.collection, centerLat, centerLon);
    const activeNearby = {
      status: historyWarnings?.status ?? "unavailable",
      warnings: mergeWarnings([historical, active], windowStart, now),
    };
    const user = readSession(request);
    const photos = user
      ? kind === "area" && bounds
        ? pinsInBounds(user.id, bounds)
        : pinsInRadius(user.id, centerLat, centerLon, radiusKm)
      : [];
    const id = randomUUID();
    const document = buildStormReport({
      id,
      title: label,
      kind,
      label,
      lat: centerLat,
      lon: centerLon,
      radiusKm: kind === "address" ? radiusKm : null,
      bounds: kind === "area" ? bounds : null,
      hours,
      history,
      listed:
        kind === "area"
          ? pool.map((report) => ({
              ...report,
              distanceKm: haversineKm(centerLat, centerLon, report.lat, report.lon),
            }))
          : history.reports,
      photos,
      meshStatus: map.sourceStatus?.mesh ?? "skipped",
      radar: radar,
      nearbyWarnings: activeNearby.warnings,
      nearbyWarningNote:
        activeNearby.status === "unavailable"
          ? "Archived NWS warnings could not be checked. Active alerts are listed above when the warning feed responded."
          : activeNearby.warnings.length
            ? null
            : "No severe thunderstorm or tornado warning was found for this point in the window.",
      snapshotSvg,
    });
    saveStormReport(user?.id ?? null, label, document, id);
    return Response.json({ report: document, url: `/reports/${id}` }, { status: 201 });
  } catch (error) {
    console.error("[hailmap] storm report", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not build that storm report" }, { status: 500 });
  }
}
