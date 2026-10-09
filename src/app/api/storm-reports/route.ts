import { createHash, randomUUID } from "node:crypto";
import { pinsInBounds, pinsInRadius, saveStormReport, listStormReports, takeActionSlot } from "@/lib/accounts";
import { readSession } from "@/lib/auth";
import { TIME_WINDOWS } from "@/lib/filters";
import { haversineKm, validLatLon } from "@/lib/geo";
import { getMapReports } from "@/lib/ingest";
import { getLiveThreats } from "@/lib/live-threats";
import { buildPlaceHistory, swathEvidence } from "@/lib/place";
import { buildStormReport } from "@/lib/storm-report";
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
  const hours = Number(record.hours ?? 168);
  if (!WINDOW_HOURS.has(hours)) return Response.json({ error: "hours must be a map time window" }, { status: 400 });
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
    const [map, threats] = await Promise.all([
      getMapReports({ fresh: hours <= 1 }),
      getLiveThreats().catch(() => null),
    ]);
    const now = Date.now();
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
    });
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
    });
    saveStormReport(user?.id ?? null, label, document, id);
    return Response.json({ report: document, url: `/reports/${id}` }, { status: 201 });
  } catch (error) {
    console.error("[hailmap] storm report", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not build that storm report" }, { status: 500 });
  }
}
