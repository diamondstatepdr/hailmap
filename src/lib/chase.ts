import { haversineKm } from "@/lib/geo";
import {
  MIN_HAIL_IN,
  confidenceFor,
  inBounds,
  latestEvidenceMs,
  recencyFactor,
  scoreHoney,
  scorePlaces,
  sourceLabel,
  type HailEvidence,
  type HoneyBounds,
  type HoneyMode,
  type HoneyPlace,
} from "@/lib/honey";
import { addIsoDays } from "@/lib/mesh-plan";
import { convectiveDay } from "@/lib/parsers";
import {
  isoWeekKey,
  type ChaseHit,
  type ChasePayload,
  type ChaseStop,
} from "@/lib/chase-week";

export {
  CHASE_PREVIEW,
  chaseListIsNew,
  chasePopupKey,
  chaseViewedKey,
  isoWeekKey,
  shouldShowWeeklyChase,
} from "@/lib/chase-week";
export type { ChaseHit, ChasePayload, ChaseStop } from "@/lib/chase-week";

/** Full Chase List length under Storms. */
export const CHASE_LIST_LIMIT = 12;
export const CHASE_FALLBACK_LIMIT = 8;
/** Inclusive convective days in "this week" of storms. */
export const CHASE_WINDOW_DAYS = 7;
/** How far back a quiet week looks for a major storm. */
export const CHASE_LOOKBACK_DAYS = 120;
/** Hail at or above this, in the window, is a chase week. */
export const CHASE_FRESH_IN = 1;
/** Older storms at or above this fill a quiet week. */
export const MAJOR_HAIL_IN = 1.75;
export const AREA_RADIUS_KM = 28;

interface ChaseCluster {
  id: string;
  name: string;
  lat: number;
  lon: number;
  bounds: HoneyBounds;
  hits: ChaseHit[];
  places: HoneyPlace[];
}

export function chaseWindow(now: Date): { start: string; end: string; lookback: string } {
  const end = convectiveDay(now);
  return {
    end,
    start: addIsoDays(end, -(CHASE_WINDOW_DAYS - 1)),
    lookback: addIsoDays(end, -CHASE_LOOKBACK_DAYS),
  };
}

function hitInches(hit: ChaseHit): number {
  return Math.max(hit.radarIn ?? 0, hit.spotterIn ?? 0);
}

function statesCompatible(left: ChaseHit, right: ChaseHit): boolean {
  const a = left.state?.trim().toUpperCase();
  const b = right.state?.trim().toUpperCase();
  if (!a || !b) return true;
  return a === b;
}

function areaLabel(hit: ChaseHit): string {
  const city = hit.location?.replace(/\s+/g, " ").trim() || "";
  const state = hit.state?.trim() || "";
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  const county = hit.county?.replace(/\s+county$/i, "").trim() || "";
  if (county && state) return `${county} County, ${state}`;
  if (state) return state;
  return "Hail area";
}

function padBounds(hits: ChaseHit[]): HoneyBounds {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const hit of hits) {
    west = Math.min(west, hit.lon);
    east = Math.max(east, hit.lon);
    south = Math.min(south, hit.lat);
    north = Math.max(north, hit.lat);
  }
  const pad = 0.22;
  return {
    west: Math.round((west - pad) * 1e4) / 1e4,
    south: Math.round((south - pad) * 1e4) / 1e4,
    east: Math.round((east + pad) * 1e4) / 1e4,
    north: Math.round((north + pad) * 1e4) / 1e4,
  };
}

/** Group hail hits into city-scale chase areas. The name follows the biggest stone. */
export function clusterChaseHits(hits: ChaseHit[], radiusKm = AREA_RADIUS_KM): ChaseCluster[] {
  const sorted = [...hits].sort((a, b) => hitInches(b) - hitInches(a) || a.stormDate.localeCompare(b.stormDate) || a.lat - b.lat);
  const groups: ChaseHit[][] = [];
  for (const hit of sorted) {
    if (hitInches(hit) < MIN_HAIL_IN) continue;
    let best: { index: number; distance: number } | null = null;
    for (let index = 0; index < groups.length; index += 1) {
      for (const member of groups[index]) {
        if (!statesCompatible(member, hit)) continue;
        const distance = haversineKm(member.lat, member.lon, hit.lat, hit.lon);
        if (distance > radiusKm) continue;
        if (!best || distance < best.distance) best = { index, distance };
      }
    }
    if (best) groups[best.index].push(hit);
    else groups.push([hit]);
  }
  return groups.map((group) => {
    const peak = group.reduce((best, hit) => (hitInches(hit) > hitInches(best) ? hit : best));
    let named: ChaseHit | null = null;
    for (const hit of group) {
      if (!hit.location?.trim()) continue;
      if (haversineKm(hit.lat, hit.lon, peak.lat, peak.lon) > radiusKm) continue;
      if (!named || hitInches(hit) > hitInches(named)) named = hit;
    }
    return {
      id: `${peak.lat.toFixed(2)},${peak.lon.toFixed(2)}`,
      name: areaLabel(named ?? peak),
      lat: peak.lat,
      lon: peak.lon,
      bounds: padBounds(group),
      hits: group,
      places: [],
    };
  });
}

function hitsToEvidence(hits: ChaseHit[]): HailEvidence[] {
  const evidence: HailEvidence[] = [];
  for (const hit of hits) {
    const confidence = hit.confidence === "nws" || hit.confidence === "community" ? hit.confidence : "spotter";
    if (hit.spotterIn != null && hit.spotterIn >= 0.5) {
      evidence.push({
        lat: hit.lat,
        lon: hit.lon,
        sizeIn: hit.spotterIn,
        occurredAt: hit.occurredAt,
        confidence,
        location: hit.location,
      });
    }
    if (hit.radarIn != null && hit.radarIn >= 0.5) {
      evidence.push({
        lat: hit.lat,
        lon: hit.lon,
        sizeIn: hit.radarIn,
        occurredAt: hit.occurredAt,
        confidence: "mesh",
        location: hit.location,
      });
    }
  }
  return evidence;
}

/** Same 0.1° MESH bin the history index uses. A lot in the next cell is not under that hail. */
function sameMeshBin(lat: number, lon: number, hitLat: number, hitLon: number): boolean {
  return Math.round(lat * 10) === Math.round(hitLat * 10) && Math.round(lon * 10) === Math.round(hitLon * 10);
}

function nearestRadar(lat: number, lon: number, hits: ChaseHit[]): number | null {
  let best: number | null = null;
  for (const hit of hits) {
    if (hit.radarIn == null || hit.radarIn < MIN_HAIL_IN) continue;
    if (!sameMeshBin(lat, lon, hit.lat, hit.lon)) continue;
    best = best == null ? hit.radarIn : Math.max(best, hit.radarIn);
  }
  return best;
}

function maxOrNull(values: Array<number | null>): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    max = max == null ? value : Math.max(max, value);
  }
  return max;
}

function dayConfidence(hits: ChaseHit[]) {
  const meshIn = maxOrNull(hits.map((hit) => hit.radarIn));
  const spotter = hits.reduce<ChaseHit | null>((best, hit) => {
    if (hit.spotterIn == null) return best;
    if (!best || (hit.spotterIn ?? 0) > (best.spotterIn ?? 0)) return hit;
    return best;
  }, null);
  const report: HailEvidence | null = spotter && spotter.spotterIn != null
    ? {
        lat: spotter.lat,
        lon: spotter.lon,
        sizeIn: spotter.spotterIn,
        occurredAt: spotter.occurredAt,
        confidence: spotter.confidence === "mesh" ? "spotter" : spotter.confidence,
        location: spotter.location,
      }
    : null;
  return confidenceFor({ meshIn, report });
}

function pathTotals(places: HoneyPlace[], hits: ChaseHit[], now: number): { vehicles: number; homes: number; measured: boolean } {
  if (!places.length) return { vehicles: 0, homes: 0, measured: false };
  const evidence = hitsToEvidence(hits);
  const scored = scorePlaces(places, evidence, (lat, lon) => nearestRadar(lat, lon, hits), false, now);
  return {
    vehicles: scored.reduce((sum, place) => sum + place.vehicles, 0),
    homes: scored.reduce((sum, place) => sum + place.homes, 0),
    measured: true,
  };
}

function scoreDay(
  cluster: ChaseCluster,
  dayHits: ChaseHit[],
  mode: HoneyMode,
  recencyLatest: number | null,
  now: Date,
): ChaseStop | null {
  const confidence = dayConfidence(dayHits);
  if (confidence.hailIn < MIN_HAIL_IN) return null;
  const totals = pathTotals(cluster.places, dayHits, now.getTime());
  // An uncounted area is not ranked. The weekly build loads lots and homes first,
  // so a published row always carries the count that produced its score.
  if (!totals.measured) return null;
  const count = mode === "pdr" ? totals.vehicles : totals.homes;
  if (count <= 0) return null;
  const used = count;
  const occurred = dayHits.reduce<string | null>((latest, hit) => {
    if (!hit.occurredAt) return latest;
    if (!latest || hit.occurredAt > latest) return hit.occurredAt;
    return latest;
  }, null);
  const scored = scoreHoney({
    mode,
    hailIn: confidence.hailIn,
    count: used,
    recency: recencyFactor(occurred, recencyLatest, false, now.getTime()),
    confidence: confidence.factor,
  });
  if (scored.score <= 0) return null;
  const date = dayHits[0]?.stormDate ?? "";
  return {
    id: `${cluster.id}:${date}`,
    name: cluster.name,
    date,
    lat: cluster.lat,
    lon: cluster.lon,
    bounds: cluster.bounds,
    radarIn: maxOrNull(dayHits.map((hit) => hit.radarIn)),
    spotterIn: maxOrNull(dayHits.map((hit) => hit.spotterIn)),
    vehicles: totals.vehicles,
    homes: totals.homes,
    score: scored.score,
    raw: Math.round(scored.raw * 1000) / 1000,
    level: scored.level,
    source: confidence.source,
    sourceLabel: sourceLabel(confidence.source),
    density: "measured",
  };
}

function byDate(hits: ChaseHit[]): Map<string, ChaseHit[]> {
  const days = new Map<string, ChaseHit[]>();
  for (const hit of hits) {
    const list = days.get(hit.stormDate) ?? [];
    list.push(hit);
    days.set(hit.stormDate, list);
  }
  return days;
}

function betterFresh(next: ChaseStop, current: ChaseStop | null): boolean {
  if (!current) return true;
  return next.raw > current.raw || (next.raw === current.raw && next.date > current.date);
}

function betterFallback(next: ChaseStop, current: ChaseStop | null): boolean {
  if (!current) return true;
  if (next.date !== current.date) return next.date > current.date;
  return next.raw > current.raw;
}

function rankMode(clusters: ChaseCluster[], mode: HoneyMode, now: Date, window: { start: string; end: string; lookback: string }, weekLatest: number | null): { fresh: ChaseStop[]; fallback: ChaseStop[] } {
  const fresh: ChaseStop[] = [];
  const fallback: ChaseStop[] = [];
  for (const cluster of clusters) {
    let bestFresh: ChaseStop | null = null;
    let bestFallback: ChaseStop | null = null;
    for (const [date, dayHits] of byDate(cluster.hits)) {
      const hail = Math.max(...dayHits.map(hitInches));
      if (date >= window.start && date <= window.end && hail >= CHASE_FRESH_IN) {
        const dayLatest = latestEvidenceMs(hitsToEvidence(dayHits));
        const stop = scoreDay(cluster, dayHits, mode, weekLatest ?? dayLatest, now);
        if (stop && betterFresh(stop, bestFresh)) bestFresh = stop;
      } else if (date >= window.lookback && date < window.start && hail >= MAJOR_HAIL_IN) {
        const dayLatest = latestEvidenceMs(hitsToEvidence(dayHits));
        const stop = scoreDay(cluster, dayHits, mode, dayLatest, now);
        if (stop && betterFallback(stop, bestFallback)) bestFallback = stop;
      }
    }
    if (bestFresh) fresh.push(bestFresh);
    else if (bestFallback) fallback.push(bestFallback);
  }
  fresh.sort((a, b) => b.raw - a.raw || b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  fallback.sort((a, b) => b.date.localeCompare(a.date) || b.raw - a.raw || a.name.localeCompare(b.name));
  return { fresh: fresh.slice(0, CHASE_LIST_LIMIT), fallback: fallback.slice(0, CHASE_FALLBACK_LIMIT) };
}

function assignPlaces(clusters: ChaseCluster[], places: HoneyPlace[]) {
  for (const place of places) {
    let best: { cluster: ChaseCluster; distance: number } | null = null;
    for (const cluster of clusters) {
      if (!inBounds(place.lat, place.lon, cluster.bounds)) continue;
      const distance = haversineKm(place.lat, place.lon, cluster.lat, cluster.lon);
      if (!best || distance < best.distance) best = { cluster, distance };
    }
    if (best) best.cluster.places.push(place);
  }
}

/**
 * Rank the last 7 days of hail areas with the Money Hole score.
 * A week with nothing at 1 inch is quiet and lists recent major storms instead.
 */
export function rankChaseWeek(input: { hits: ChaseHit[]; places: HoneyPlace[]; now: Date; partial?: boolean }): ChasePayload {
  const window = chaseWindow(input.now);
  const clusters = clusterChaseHits(input.hits);
  assignPlaces(clusters, input.places);
  const windowEvidence = hitsToEvidence(
    input.hits.filter((hit) => hit.stormDate >= window.start && hit.stormDate <= window.end && hitInches(hit) >= MIN_HAIL_IN),
  );
  const weekLatest = latestEvidenceMs(windowEvidence);
  const pdr = rankMode(clusters, "pdr", input.now, window, weekLatest);
  const roof = rankMode(clusters, "roof", input.now, window, weekLatest);
  const quiet = pdr.fresh.length === 0 && roof.fresh.length === 0;
  const listed = quiet
    ? [...pdr.fallback, ...roof.fallback]
    : [...pdr.fresh, ...roof.fresh];
  return {
    version: 3,
    week: isoWeekKey(input.now),
    generatedAt: input.now.toISOString(),
    windowStart: window.start,
    windowEnd: window.end,
    quiet,
    partial: input.partial === true,
    fresh: quiet ? { pdr: [], roof: [] } : { pdr: pdr.fresh, roof: roof.fresh },
    fallback: quiet ? { pdr: pdr.fallback, roof: roof.fallback } : { pdr: [], roof: [] },
  };
}
