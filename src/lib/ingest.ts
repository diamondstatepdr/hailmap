import { fuseReports } from "@/lib/dedupe";
import {
  deleteSeedReports,
  getMeta,
  listRecentReports,
  pruneLiveReports,
  setMeta,
  upsertReports,
} from "@/lib/db";
import {
  addUtcDays,
  convectiveDay,
  parseIemGeoJson,
  parseMeshGeoJson,
  parseNwsAlerts,
  parseSpcHailCsv,
  spcFileStamp,
} from "@/lib/parsers";
import type { IncomingReport, ReportsResponse, SourceStatus } from "@/lib/types";

const SYNC_TTL_MS = 10 * 60 * 1000;

let lastSync = 0;
let inflight: Promise<void> | null = null;

export function userAgent(): string {
  return (
    process.env.HAILMAP_USER_AGENT?.trim() ||
    "HailMap/1.0 (https://github.com/diamondstatepdr/hailmap)"
  );
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: "text/csv,text/plain,*/*" },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

async function fetchJson(url: string, accept: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: accept },
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchSpc(): Promise<IncomingReport[]> {
  const today = convectiveDay();
  const days = Array.from({ length: 7 }, (_, index) => addUtcDays(today, -index));
  let failures = 0;
  const batches = await Promise.all(
    days.map(async (day) => {
      try {
        const stamp = spcFileStamp(day);
        const csv = await fetchText(`https://www.spc.noaa.gov/climo/reports/${stamp}_rpts_hail.csv`);
        return parseSpcHailCsv(csv, day);
      } catch (error) {
        failures += 1;
        console.error("[hailmap] spc", day, error instanceof Error ? error.message : error);
        return [];
      }
    }),
  );
  if (failures === days.length) throw new Error("SPC hail reports unavailable");
  return batches.flat();
}

async function fetchIem(): Promise<IncomingReport[]> {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 86400000);
  const stamp = (date: Date) =>
    date.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const url = `https://mesonet.agron.iastate.edu/geojson/lsr.py?sts=${stamp(start)}&ets=${stamp(end)}`;
  const payload = await fetchJson(url, "application/geo+json, application/json");
  return parseIemGeoJson(payload);
}

async function fetchNws(): Promise<IncomingReport[]> {
  const payload = await fetchJson(
    "https://api.weather.gov/alerts/active?status=actual&message_type=alert",
    "application/geo+json, application/json",
  );
  return parseNwsAlerts(payload);
}

async function fetchMesh(): Promise<IncomingReport[]> {
  const url = process.env.HAILMAP_MESH_URL?.trim();
  if (!url) return [];
  const payload = await fetchJson(url, "application/geo+json, application/json");
  return parseMeshGeoJson(payload);
}

async function loadFeed(
  status: SourceStatus["spc"],
  run: () => Promise<IncomingReport[]>,
): Promise<{ status: SourceStatus["spc"]; reports: IncomingReport[] }> {
  try {
    const reports = await run();
    return { status: reports.length ? "ok" : status === "skipped" ? "skipped" : "empty", reports };
  } catch (error) {
    console.error("[hailmap] feed", error instanceof Error ? error.message : error);
    return { status: "error", reports: [] };
  }
}

export async function syncLive(): Promise<SourceStatus> {
  const meshConfigured = Boolean(process.env.HAILMAP_MESH_URL?.trim());
  const [spc, iem, nws, mesh] = await Promise.all([
    loadFeed("empty", fetchSpc),
    loadFeed("empty", fetchIem),
    loadFeed("empty", fetchNws),
    meshConfigured ? loadFeed("empty", fetchMesh) : Promise.resolve({ status: "skipped" as const, reports: [] }),
  ]);
  const status: SourceStatus = {
    spc: spc.status,
    iem: iem.status,
    nws: nws.status,
    mesh: mesh.status,
  };
  const rows = [...spc.reports, ...iem.reports, ...nws.reports, ...mesh.reports];
  if (rows.length) upsertReports(rows);
  pruneLiveReports(new Date(Date.now() - 8 * 86400000).toISOString());
  const reachable = [spc, iem, nws].some((feed) => feed.status === "ok" || feed.status === "empty");
  if (reachable) deleteSeedReports();
  setMeta("syncedAt", new Date().toISOString());
  setMeta("sourceStatus", JSON.stringify(status));
  return status;
}

export async function ensureFresh() {
  if (Date.now() - lastSync < SYNC_TTL_MS) return;
  if (!inflight) {
    inflight = syncLive()
      .then(() => undefined)
      .catch((error) => {
        console.error("[hailmap] sync", error);
      })
      .finally(() => {
        lastSync = Date.now();
        inflight = null;
      });
  }
  await inflight;
}

export async function getMapReports(): Promise<ReportsResponse> {
  await ensureFresh();
  const all = listRecentReports(7);
  const live = all.filter((report) => report.source !== "seed");
  const chosen = live.length ? live : all;
  const reports = fuseReports(chosen);
  const rawStatus = getMeta("sourceStatus");
  let sourceStatus: SourceStatus | null = null;
  if (rawStatus) {
    try {
      sourceStatus = JSON.parse(rawStatus) as SourceStatus;
    } catch {
      sourceStatus = null;
    }
  }
  return {
    updatedAt: new Date().toISOString(),
    syncedAt: getMeta("syncedAt"),
    sourceStatus,
    rawCount: chosen.length,
    reports,
  };
}

export async function getSwathCollection() {
  const { reports } = await getMapReports();
  const { reportsToSwaths } = await import("@/lib/swath");
  return reportsToSwaths(reports);
}
