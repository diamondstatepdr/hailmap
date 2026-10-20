import { listRecentReports } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { CHASE_LOOKBACK_DAYS, chaseWindow, clusterChaseHits, rankChaseWeek, type ChaseHit, type ChasePayload } from "@/lib/chase";
import type { HoneyPlace } from "@/lib/honey";
import { cachedOsmTargets } from "@/lib/honey-osm";
import { historyDb } from "@/lib/history-db";
import { convectiveDay } from "@/lib/parsers";

interface HistoryHailRow {
  lat: number;
  lon: number;
  size_in: number | null;
  occurred_at: string;
  storm_date: string;
  state: string | null;
  location: string | null;
  county: string | null;
  confidence: string;
}

interface MeshCellRow {
  storm_date: string;
  lat_q: number;
  lon_q: number;
  max_in: number;
}

function asConfidence(value: string): ChaseHit["confidence"] {
  if (value === "nws" || value === "spotter" || value === "community" || value === "mesh") return value;
  return "nws";
}

function hailOf(hit: ChaseHit): number {
  return Math.max(hit.radarIn ?? 0, hit.spotterIn ?? 0);
}

/** Hail hits for the chase window and the quiet-week lookback. Spotter and radar stay separate. */
export function loadChaseHits(now = new Date()): ChaseHit[] {
  const window = chaseWindow(now);
  const hits: ChaseHit[] = [];
  const seen = new Set<string>();
  const push = (hit: ChaseHit) => {
    if (hailOf(hit) < 0.75) return;
    if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lon)) return;
    const key = `${hit.stormDate}|${hit.lat.toFixed(2)}|${hit.lon.toFixed(2)}|${(hit.spotterIn ?? 0).toFixed(2)}|${(hit.radarIn ?? 0).toFixed(2)}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };

  let mesh = new Map<string, number>();
  try {
    const rows = historyDb()
      .prepare(
        `SELECT lat, lon, size_in, occurred_at, storm_date, state, location, county, confidence
         FROM history_reports
         WHERE hazard = 'hail' AND size_in >= 0.75 AND storm_date >= ? AND storm_date <= ?
         ORDER BY size_in DESC
         LIMIT 1500`,
      )
      .all(window.lookback, window.end) as HistoryHailRow[];
    for (const row of rows) {
      if (row.size_in == null) continue;
      const confidence = asConfidence(row.confidence);
      push({
        lat: row.lat,
        lon: row.lon,
        stormDate: row.storm_date,
        occurredAt: row.occurred_at,
        location: row.location,
        county: row.county,
        state: row.state,
        spotterIn: confidence === "mesh" ? null : row.size_in,
        radarIn: confidence === "mesh" ? row.size_in : null,
        confidence,
      });
    }
  } catch (error) {
    console.error("[hailmap] chase history", error instanceof Error ? error.message : error);
  }

  try {
    const cells = historyDb()
      .prepare(
        `SELECT storm_date, lat_q, lon_q, max_in FROM mesh_cells
         WHERE storm_date >= ? AND storm_date <= ? AND max_in >= 0.75
         LIMIT 25000`,
      )
      .all(window.lookback, window.end) as MeshCellRow[];
    mesh = new Map();
    for (const cell of cells) {
      const key = `${cell.storm_date}|${cell.lat_q}|${cell.lon_q}`;
      mesh.set(key, Math.max(mesh.get(key) ?? 0, cell.max_in));
    }
    const buckets = new Map<string, { lat: number; lon: number; inches: number; date: string }>();
    for (const cell of cells) {
      const lat = cell.lat_q / 10;
      const lon = cell.lon_q / 10;
      const key = `${cell.storm_date}|${Math.floor(lat / 0.45)}|${Math.floor(lon / 0.45)}`;
      const prev = buckets.get(key);
      if (!prev || cell.max_in > prev.inches) buckets.set(key, { lat, lon, inches: cell.max_in, date: cell.storm_date });
    }
    for (const bucket of buckets.values()) {
      const covered = hits.some((hit) => hit.stormDate === bucket.date && haversineKm(hit.lat, hit.lon, bucket.lat, bucket.lon) <= 30);
      if (covered) continue;
      push({
        lat: bucket.lat,
        lon: bucket.lon,
        stormDate: bucket.date,
        occurredAt: `${bucket.date}T23:00:00.000Z`,
        location: null,
        county: null,
        state: null,
        spotterIn: null,
        radarIn: Math.round(bucket.inches * 100) / 100,
        confidence: "mesh",
      });
    }
  } catch (error) {
    console.error("[hailmap] chase mesh", error instanceof Error ? error.message : error);
  }

  const stampRadar = (hit: ChaseHit) => {
    const latQ = Math.round(hit.lat * 10);
    const lonQ = Math.round(hit.lon * 10);
    let max = hit.radarIn ?? 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        max = Math.max(max, mesh.get(`${hit.stormDate}|${latQ + dy}|${lonQ + dx}`) ?? 0);
      }
    }
    if (max >= 0.75) hit.radarIn = Math.round(max * 100) / 100;
  };
  for (const hit of hits) stampRadar(hit);

  try {
    for (const report of listRecentReports(CHASE_LOOKBACK_DAYS)) {
      if (report.source === "seed" || report.hazard !== "hail" || report.sizeIn == null || report.sizeIn < 0.75) continue;
      const occurred = Date.parse(report.occurredAt);
      if (!Number.isFinite(occurred)) continue;
      const stormDate = convectiveDay(new Date(occurred));
      if (stormDate < window.lookback || stormDate > window.end) continue;
      const confidence = asConfidence(report.confidence);
      const hit: ChaseHit = {
        lat: report.lat,
        lon: report.lon,
        stormDate,
        occurredAt: report.occurredAt,
        location: report.location,
        county: report.county,
        state: report.state,
        spotterIn: confidence === "mesh" ? null : report.sizeIn,
        radarIn: confidence === "mesh" ? report.sizeIn : null,
        confidence,
      };
      stampRadar(hit);
      push(hit);
    }
  } catch (error) {
    console.error("[hailmap] chase live", error instanceof Error ? error.message : error);
  }

  return hits;
}

function cachedPlaces(hits: ChaseHit[]): HoneyPlace[] {
  const clusters = [...clusterChaseHits(hits)].sort((a, b) => {
    const hail = (cluster: typeof a) => Math.max(...cluster.hits.map(hailOf));
    return hail(b) - hail(a);
  });
  const places: HoneyPlace[] = [];
  const seen = new Set<string>();
  for (const cluster of clusters.slice(0, 24)) {
    const hail = Math.max(...cluster.hits.map(hailOf));
    if (hail < 0.75) continue;
    try {
      const cached = cachedOsmTargets(cluster.bounds, () => hail);
      for (const place of cached.targets) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);
        places.push(place);
      }
    } catch (error) {
      console.error("[hailmap] chase lots", error instanceof Error ? error.message : error);
    }
  }
  return places;
}

/** Build this week's chase list from stored hail, radar, and cached Money Hole lots. */
export async function computeChase(now = new Date()): Promise<ChasePayload> {
  const hits = loadChaseHits(now);
  const places = cachedPlaces(hits);
  return rankChaseWeek({ hits, places, now });
}
