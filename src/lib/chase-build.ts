import { listRecentReports } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { CHASE_LOOKBACK_DAYS, chaseWindow, clusterChaseHits, rankChaseWeek, type ChaseHit, type ChasePayload } from "@/lib/chase";
import { stampClusterTowns } from "@/lib/chase-town";
import { inBounds, type HoneyPlace } from "@/lib/honey";
import { loadRoofTracts } from "@/lib/honey-census";
import { loadOsmTargets } from "@/lib/honey-osm";
import { historyDb } from "@/lib/history-db";
import { placeChaseHit } from "@/lib/chase-place";
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

  return hits.flatMap((hit) => {
    const placed = placeChaseHit(hit);
    return placed ? [placed] : [];
  });
}

type ChaseCluster = ReturnType<typeof clusterChaseHits>[number];

/** Enough tiles to finish one chase area. The map ranking path stays capped at two. */
const CHASE_FRESH_TILES = 24;

function qualifies(cluster: ChaseCluster, now: Date): "fresh" | "major" | null {
  const window = chaseWindow(now);
  let fresh = false;
  let major = false;
  for (const hit of cluster.hits) {
    const hail = hailOf(hit);
    if (hit.stormDate >= window.start && hit.stormDate <= window.end && hail >= 1) fresh = true;
    else if (hit.stormDate >= window.lookback && hit.stormDate < window.start && hail >= 1.75) major = true;
  }
  if (fresh) return "fresh";
  if (major) return "major";
  return null;
}

function latestDate(cluster: ChaseCluster): string {
  return cluster.hits.reduce((latest, hit) => (hit.stormDate > latest ? hit.stormDate : latest), "");
}

async function measureCluster(cluster: ChaseCluster): Promise<{ places: HoneyPlace[]; complete: boolean }> {
  const hail = Math.max(0, ...cluster.hits.map(hailOf));
  const [osm, census] = await Promise.all([
    loadOsmTargets(cluster.bounds, () => hail, CHASE_FRESH_TILES).catch((error: unknown) => {
      console.error("[hailmap] chase lots", error instanceof Error ? error.message : error);
      return null;
    }),
    loadRoofTracts(cluster.bounds).catch((error: unknown) => {
      console.error("[hailmap] chase homes", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  const places: HoneyPlace[] = [];
  let complete = true;
  if (!osm || osm.partial) complete = false;
  else places.push(...osm.targets);
  if (census && !census.partial && !census.unavailable) {
    for (const tract of census.tracts) {
      if (tract.homes <= 0 || !inBounds(tract.lat, tract.lon, cluster.bounds)) continue;
      places.push({
        id: `tract/${tract.geoid}`,
        kind: "homes",
        name: tract.basename,
        city: null,
        neighborhood: null,
        lat: tract.lat,
        lon: tract.lon,
        vehicles: 0,
        homes: tract.homes,
        vehicleBasis: "default",
      });
    }
  } else if (!census) {
    complete = false;
  }
  return { places, complete };
}

async function collectPlaces(clusters: ChaseCluster[]): Promise<{ places: HoneyPlace[]; partial: boolean }> {
  const places: HoneyPlace[] = [];
  const seen = new Set<string>();
  let partial = false;
  for (const cluster of clusters) {
    const measured = await measureCluster(cluster);
    if (!measured.complete) partial = true;
    for (const place of measured.places) {
      if (seen.has(place.id)) continue;
      seen.add(place.id);
      places.push(place);
    }
    console.log(
      `[hailmap] chase count ${cluster.name} places=${measured.places.length} complete=${measured.complete}`,
    );
  }
  return { places, partial };
}

/**
 * Vehicle and home counts for every area that can make the list.
 * Counts finish before rankChaseWeek, including a quiet week's fallback storms.
 */
async function loadMeasuredPlaces(hits: ChaseHit[], now: Date): Promise<{ places: HoneyPlace[]; partial: boolean; holdQuiet: boolean }> {
  const clusters = clusterChaseHits(hits);
  const fresh: ChaseCluster[] = [];
  const major: ChaseCluster[] = [];
  for (const cluster of clusters) {
    const kind = qualifies(cluster, now);
    if (kind === "fresh") fresh.push(cluster);
    else if (kind === "major") major.push(cluster);
  }
  await stampClusterTowns(fresh);
  const counted = await collectPlaces(fresh);
  const preview = rankChaseWeek({ hits, places: counted.places, now });
  if (preview.quiet && counted.partial) {
    return { places: counted.places, partial: true, holdQuiet: true };
  }
  if (!preview.quiet) return { places: counted.places, partial: counted.partial, holdQuiet: false };
  major.sort((a, b) => latestDate(b).localeCompare(latestDate(a)));
  const fallback = major.slice(0, 16);
  await stampClusterTowns(fallback);
  const older = await collectPlaces(fallback);
  return {
    places: [...counted.places, ...older.places],
    partial: counted.partial || older.partial,
    holdQuiet: false,
  };
}

/** Build this week's chase list from stored hail, with lots and homes counted first. */
export async function computeChase(now = new Date()): Promise<ChasePayload> {
  const hits = loadChaseHits(now);
  const measured = await loadMeasuredPlaces(hits, now);
  const payload = rankChaseWeek({ hits, places: measured.places, now, partial: measured.partial });
  if (measured.holdQuiet && payload.quiet) {
    return {
      ...payload,
      quiet: false,
      fresh: { pdr: [], roof: [] },
      fallback: { pdr: [], roof: [] },
    };
  }
  return payload;
}
