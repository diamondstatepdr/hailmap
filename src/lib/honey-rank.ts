import { listRecentReports } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { selectHistory } from "@/lib/history-db";
import {
  clusterPlaces,
  emptyHeat,
  inBounds,
  scorePlaces,
  spotsToHeat,
  toSpots,
  type HailEvidence,
  type HoneyBounds,
  type HoneyPlace,
  type HoneySpot,
  type ScoredPlace,
} from "@/lib/honey";
import { loadRoofTracts, scheduleCensusFill } from "@/lib/honey-census";
import { loadOsmTargets, scheduleOsmFill, type PlaceLabel } from "@/lib/honey-osm";
import { getMapReports } from "@/lib/ingest";
import { indexCells, sampleIndexed, type MeshCell, type MeshGridShape } from "@/lib/mesh-contour";
import { loadPlanGrids } from "@/lib/mesh-cache";
import { addIsoDays, formatStormDate, isoDateUTC, planMesh } from "@/lib/mesh-plan";
import { convectiveDay } from "@/lib/parsers";
import { ensureDaily } from "@/lib/spc-archive";

export interface HoneyPayload {
  date: string | null;
  label: string;
  live: boolean;
  /** True while OpenStreetMap or Census tiles for this view are still being cached. */
  partial: boolean;
  /** `partial` while lots are still loading. `complete` is a finished ranking. */
  status: "partial" | "complete";
  zoom: boolean;
  note: string | null;
  attribution: string;
  spots: { pdr: HoneySpot[]; roof: HoneySpot[] };
  heat: { pdr: GeoJSON.FeatureCollection; roof: GeoJSON.FeatureCollection };
}

const ATTRIBUTION =
  "Lots and apartments © OpenStreetMap contributors. Homes from US Census ACS housing units. Hail from radar estimates and official spotter reports.";

const MAX_SPAN_KM = 210;

function emptyPayload(label: string, note: string, zoom = false): HoneyPayload {
  return {
    date: null,
    label,
    live: false,
    partial: false,
    status: "complete",
    zoom,
    note,
    attribution: ATTRIBUTION,
    spots: { pdr: [], roof: [] },
    heat: { pdr: emptyHeat(), roof: emptyHeat() },
  };
}

function meshSampler(grids: Array<{ shape: MeshGridShape; cells: MeshCell[] }>): (lat: number, lon: number) => number | null {
  const indexed = grids
    .filter((grid) => grid.cells.length && grid.shape.nx > 0 && grid.shape.step > 0)
    .map((grid) => ({ index: indexCells(grid.cells, grid.shape), shape: grid.shape }));
  return (lat, lon) => {
    let max: number | null = null;
    for (const grid of indexed) {
      const value = sampleIndexed(grid.index, grid.shape, lat, lon);
      if (value == null) continue;
      max = max == null ? value : Math.max(max, value);
    }
    return max;
  };
}

function tileHail(tile: HoneyBounds, meshAt: (lat: number, lon: number) => number | null, reports: HailEvidence[]): number {
  let max = 0;
  for (let lat = tile.south + 0.04; lat < tile.north; lat += 0.08) {
    for (let lon = tile.west + 0.04; lon < tile.east; lon += 0.08) {
      max = Math.max(max, meshAt(lat, lon) ?? 0);
    }
  }
  for (const report of reports) {
    if (inBounds(report.lat, report.lon, tile)) max = Math.max(max, report.sizeIn);
  }
  return max;
}

function pushEvidence(bucket: HailEvidence[], seen: Set<string>, report: HailEvidence) {
  if (!inBoundsReady(report)) return;
  const key = `${report.lat.toFixed(2)}|${report.lon.toFixed(2)}|${report.sizeIn.toFixed(2)}`;
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push(report);
}

function inBoundsReady(report: HailEvidence): boolean {
  return Number.isFinite(report.lat) && Number.isFinite(report.lon) && report.sizeIn >= 0.5;
}

async function loadReports(input: {
  date: string | null;
  hours: number | null;
  bounds: HoneyBounds;
  now: Date;
}): Promise<HailEvidence[]> {
  const evidence: HailEvidence[] = [];
  const seen = new Set<string>();
  if (input.date) {
    try {
      await ensureDaily(input.date, input.now);
    } catch (error) {
      console.error("[hailmap] honey reports", error instanceof Error ? error.message : error);
    }
    const rows = selectHistory({ start: input.date, end: input.date }, input.bounds, "", 4000);
    for (const row of rows) {
      if (row.hazard !== "hail" || row.sizeIn == null) continue;
      const confidence = row.confidence === "nws" || row.confidence === "spotter" || row.confidence === "community" ? row.confidence : "nws";
      pushEvidence(evidence, seen, {
        lat: row.lat,
        lon: row.lon,
        sizeIn: row.sizeIn,
        occurredAt: row.occurredAt,
        confidence,
        location: row.location,
      });
    }
  }

  const today = isoDateUTC(input.now);
  const recentCutoff = addIsoDays(today, -8);
  const wantLive = !input.date || input.date >= recentCutoff;
  if (!wantLive) return evidence.filter((report) => inBounds(report.lat, report.lon, input.bounds));

  const hours = input.hours ?? 168;
  const cutoff = input.date ? null : input.now.getTime() - hours * 3600 * 1000;
  let reports = listRecentReports(8);
  if (!reports.length && !input.date) {
    try {
      reports = (await getMapReports({ fresh: hours <= 1 })).reports;
    } catch (error) {
      console.error("[hailmap] honey live", error instanceof Error ? error.message : error);
    }
  }
  for (const report of reports) {
    if (report.source === "seed" || report.hazard !== "hail" || report.sizeIn == null) continue;
    const occurred = Date.parse(report.occurredAt);
    if (!Number.isFinite(occurred)) continue;
    if (input.date && convectiveDay(new Date(occurred)) !== input.date) continue;
    if (cutoff != null && occurred < cutoff) continue;
    if (!inBounds(report.lat, report.lon, input.bounds)) continue;
    const confidence = report.confidence === "mesh" ? "mesh" : report.confidence === "community" ? "community" : report.confidence === "spotter" ? "spotter" : "nws";
    pushEvidence(evidence, seen, {
      lat: report.lat,
      lon: report.lon,
      sizeIn: report.sizeIn,
      occurredAt: report.occurredAt,
      confidence,
      location: report.location,
    });
  }
  return evidence;
}

function shortPlace(name: string): string {
  return name.replace(/\s+national historic district$/i, "").replace(/\s+historic district$/i, "").trim();
}

function nearestLabels(
  lat: number,
  lon: number,
  places: PlaceLabel[],
): { neighborhood: string | null; city: string | null; cityDistance: number | null; cityNorth: number | null; cityEast: number | null } {
  let neighborhood: { name: string; distance: number } | null = null;
  let city: { name: string; distance: number } | null = null;
  for (const place of places) {
    const distance = haversineKm(lat, lon, place.lat, place.lon);
    if (place.kind === "city" || place.kind === "town") {
      if (distance <= 20 && (!city || distance < city.distance)) city = { name: shortPlace(place.name), distance };
      continue;
    }
    const limit = place.kind === "suburb" ? 3.8 : place.kind === "quarter" ? 1.4 : 2.6;
    const name = shortPlace(place.name);
    if (distance <= limit && name.length <= 42 && (!neighborhood || distance < neighborhood.distance)) {
      neighborhood = { name, distance };
    }
  }
  let cityNorth: number | null = null;
  let cityEast: number | null = null;
  if (city) {
    const match = places.find((place) => (place.kind === "city" || place.kind === "town") && shortPlace(place.name) === city.name);
    if (match) {
      cityNorth = lat - match.lat;
      cityEast = lon - match.lon;
    }
  }
  return { neighborhood: neighborhood?.name ?? null, city: city?.name ?? null, cityDistance: city?.distance ?? null, cityNorth, cityEast };
}

function compassWord(north: number, east: number): string {
  const degrees = (Math.atan2(east, north) * 180) / Math.PI;
  const dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  const word = dirs[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "Fort Worth" alone is not a stop. Offset a large city from its downtown. */
function compassArea(labels: { neighborhood: string | null; city: string | null; cityDistance: number | null; cityNorth: number | null; cityEast: number | null }): string | null {
  if (labels.neighborhood || !labels.city || labels.cityDistance == null || labels.cityNorth == null || labels.cityEast == null) return null;
  const broad = labels.city === "Fort Worth" || labels.city === "Dallas" || labels.cityDistance > 8;
  if (!broad || labels.cityDistance < 2.5) return null;
  return `${compassWord(labels.cityNorth, labels.cityEast)} ${labels.city}`;
}

function nameTract(
  tract: { basename: string; county: string | null },
  labels: { neighborhood: string | null; city: string | null; cityDistance: number | null },
): string {
  const city = labels.city?.replace(/,.*$/, "").trim() || null;
  const neighborhood = labels.neighborhood?.trim() || null;
  if (
    neighborhood &&
    city &&
    neighborhood.toLowerCase() !== city.toLowerCase() &&
    !neighborhood.toLowerCase().startsWith(city.toLowerCase()) &&
    !neighborhood.toLowerCase().endsWith(city.toLowerCase())
  ) {
    return `${neighborhood}, ${city}`;
  }
  if (neighborhood) return neighborhood;
  if (city && (labels.cityDistance ?? 0) > 12) return `${city} area`;
  if (city) return city;
  if (tract.county) return tract.county;
  return `Tract ${tract.basename}`;
}

function listAndHeat(places: ScoredPlace[], mode: "pdr" | "roof", origin: { lat: number; lon: number }) {
  const ranked = toSpots(places, mode, origin, 12);
  return { list: ranked.slice(0, 12), heat: spotsToHeat(ranked, mode) };
}

export async function buildHoney(input: {
  date: string | null;
  hours: number | null;
  bounds: HoneyBounds;
  origin: { lat: number; lon: number } | null;
  now?: Date;
}): Promise<HoneyPayload> {
  const now = input.now ?? new Date();
  const span = haversineKm(input.bounds.south, input.bounds.west, input.bounds.north, input.bounds.east);
  if (span > MAX_SPAN_KM) {
    return emptyPayload("Money Hole", "Zoom in to a city and Money Hole will rank the hail-hit stops.", true);
  }
  const plan = planMesh({ date: input.date, hours: input.date ? undefined : (input.hours ?? 24), now });
  if ("error" in plan) return emptyPayload("Money holes", plan.error, false);

  const live = !input.date || input.date === isoDateUTC(now);
  const label = input.date ? formatStormDate(input.date) : plan.label;
  const origin = input.origin ?? {
    lat: (input.bounds.south + input.bounds.north) / 2,
    lon: (input.bounds.west + input.bounds.east) / 2,
  };

  const [grids, reports] = await Promise.all([
    loadPlanGrids(plan, now).catch((error) => {
      console.error("[hailmap] honey mesh", error instanceof Error ? error.message : error);
      return [];
    }),
    loadReports({ date: input.date, hours: input.hours, bounds: input.bounds, now }),
  ]);
  const meshAt = meshSampler(grids.map((grid) => ({ shape: grid.shape, cells: grid.cells })));
  const meshOk = grids.some((grid) => grid.status === "ok");

  const hailAtTile = (tile: HoneyBounds) => tileHail(tile, meshAt, reports);
  const [osm, census] = await Promise.all([
    loadOsmTargets(input.bounds, hailAtTile).catch((error) => {
      console.error("[hailmap] honey osm", error instanceof Error ? error.message : error);
      return { targets: [] as HoneyPlace[], places: [] as PlaceLabel[], partial: true };
    }),
    loadRoofTracts(input.bounds).catch(() => ({ tracts: [], partial: true, unavailable: true })),
  ]);
  if (osm.partial) scheduleOsmFill(input.bounds, hailAtTile);
  if (census.partial) scheduleCensusFill(input.bounds);

  const labeled = osm.targets.map((target) => {
    const labels = nearestLabels(target.lat, target.lon, osm.places);
    return {
      ...target,
      neighborhood: target.neighborhood ?? labels.neighborhood,
      area: target.neighborhood || labels.neighborhood ? null : compassArea(labels),
      city: target.city ?? labels.city,
    };
  });

  const tractPlaces: HoneyPlace[] = [];
  for (const tract of census.tracts) {
    if (!inBounds(tract.lat, tract.lon, {
      west: input.bounds.west - 0.02,
      south: input.bounds.south - 0.02,
      east: input.bounds.east + 0.02,
      north: input.bounds.north + 0.02,
    })) {
      continue;
    }
    const labels = nearestLabels(tract.lat, tract.lon, osm.places);
    tractPlaces.push({
      id: `tract/${tract.geoid}`,
      kind: "homes",
      name: nameTract(tract, labels),
      city: labels.city,
      neighborhood: labels.neighborhood,
      lat: tract.lat,
      lon: tract.lon,
      vehicles: 0,
      homes: tract.homes,
      vehicleBasis: "default",
    });
  }

  const scoredTargets = scorePlaces(labeled, reports, meshAt, live, now.getTime());
  const tractMesh = (lat: number, lon: number) => {
    let max = meshAt(lat, lon);
    for (const [dLat, dLon] of [
      [0.03, 0],
      [-0.03, 0],
      [0, 0.03],
      [0, -0.03],
    ] as const) {
      const value = meshAt(lat + dLat, lon + dLon);
      if (value == null) continue;
      max = max == null ? value : Math.max(max, value);
    }
    return max;
  };
  const scoredTracts = scorePlaces(tractPlaces, reports, tractMesh, live, now.getTime());
  const apartments = clusterPlaces(
    scoredTargets.filter((place) => place.kind === "apartments" && place.homes > 0),
    "roof",
    0.45,
  );
  const pdrRanked = listAndHeat(
    scoredTargets.filter((place) => place.kind !== "homes" && place.vehicles > 0),
    "pdr",
    origin,
  );
  const roofRanked = listAndHeat([...apartments, ...scoredTracts], "roof", origin);

  const stillLoading = osm.partial || census.partial;
  const notes: string[] = [];
  if (stillLoading) notes.push("Finding Money Holes…");
  if (!meshOk && reports.length) notes.push("Radar hail is unavailable, so these scores use spotter reports.");
  if (!meshOk && !reports.length) notes.push("No radar or spotter hail in this view for that day.");
  if (census.unavailable) notes.push("Census home counts are unavailable, so roofing uses apartment buildings.");
  else if (!census.partial && !roofRanked.list.length && pdrRanked.list.length) {
    notes.push("Roofing found no hail-hit neighborhoods in this view.");
  }
  if (!pdrRanked.list.length && (meshOk || reports.length) && !osm.partial) {
    notes.push("No mapped lots under the hail in this view. OpenStreetMap does not list every dealer.");
  }

  return {
    date: input.date,
    label,
    live,
    partial: stillLoading,
    status: stillLoading ? "partial" : "complete",
    zoom: false,
    note: notes.length ? notes.join(" ") : null,
    attribution: ATTRIBUTION,
    spots: { pdr: pdrRanked.list, roof: roofRanked.list },
    heat: { pdr: pdrRanked.heat, roof: roofRanked.heat },
  };
}
