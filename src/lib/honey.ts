import { haversineKm } from "@/lib/geo";
import { levelForScore, type DamageLevel } from "@/lib/probability";

/**
 * Money Hole score
 *
 * raw = hailWeight × densityFactor × recency × confidence
 *
 * hailWeight grows faster than raw inches so a 2.5 in dealer row outranks a
 * parking sea under 1 in hail. densityFactor is log1p(count) / log1p(pivot):
 * more cars or homes always rank higher, and a single enormous lot does not
 * erase every other stop. recency is 1 for the latest evidence that day and
 * decays through the morning. confidence is 1 when a spotter or NWS report
 * agrees with MRMS MESH, otherwise the usual source weight.
 *
 * The badge is 0–100. The list sorts by raw so two saturated badges still order.
 */

export const SQ_M_PER_VEHICLE = 30;
export const MIN_PARKING_M2 = 1800;
export const MIN_HAIL_IN = 0.75;
export const PDR_DENSITY_PIVOT = 120;
export const ROOF_DENSITY_PIVOT = 800;
export const CLUSTER_RADIUS_KM = 0.9;
export const REPORT_MATCH_KM = 6;

export const CONFIDENCE_WEIGHT = {
  agreed: 1,
  nws: 1,
  spotter: 0.85,
  mesh: 0.65,
  community: 0.4,
} as const;

export type HoneyMode = "pdr" | "roof";
export type HoneySource = "agreed" | "nws" | "spotter" | "mesh" | "community";
export type HoneyLevel = DamageLevel;

export interface HoneyBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface HailEvidence {
  lat: number;
  lon: number;
  sizeIn: number;
  occurredAt: string | null;
  confidence: "nws" | "spotter" | "community" | "mesh";
  location: string | null;
}

export type TargetKind = "dealership" | "parking" | "apartments" | "mall" | "fleet" | "homes";

export interface HoneyPlace {
  id: string;
  kind: TargetKind;
  name: string | null;
  city: string | null;
  neighborhood: string | null;
  lat: number;
  lon: number;
  vehicles: number;
  homes: number;
  /** Area-measured vehicles survive clustering. Defaults yield to a measured lot. */
  vehicleBasis: "area" | "default";
}

export interface ScoredPlace extends HoneyPlace {
  hailIn: number;
  recency: number;
  confidence: number;
  agreement: boolean;
  source: HoneySource;
  occurredAt: string | null;
}

export interface HoneySpot {
  id: string;
  name: string;
  kind: TargetKind;
  mode: HoneyMode;
  lat: number;
  lon: number;
  hailIn: number;
  vehicles: number | null;
  homes: number | null;
  score: number;
  raw: number;
  level: HoneyLevel;
  distanceKm: number | null;
  agreement: boolean;
  source: HoneySource;
  sourceLabel: string;
  memberCount: number;
}

export function vehiclesFromArea(areaM2: number, levels = 1): number {
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return 0;
  const floors = Math.min(8, Math.max(1, Math.round(levels) || 1));
  return Math.max(0, Math.round((areaM2 / SQ_M_PER_VEHICLE) * floors));
}

/** Shoelace area of a lon/lat ring, in square meters. */
export function ringAreaM2(ring: Array<[number, number]>): number {
  if (ring.length < 4) return 0;
  let lat = 0;
  let count = 0;
  for (const [, y] of ring) {
    if (!Number.isFinite(y)) continue;
    lat += y;
    count += 1;
  }
  if (!count) return 0;
  lat /= count;
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110_540;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = ring[i][0] * kx;
    const y1 = ring[i][1] * ky;
    const x2 = ring[i + 1][0] * kx;
    const y2 = ring[i + 1][1] * ky;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function hailWeight(inches: number): number {
  if (!Number.isFinite(inches) || inches < MIN_HAIL_IN) return 0;
  return Math.pow(inches, 1.4);
}

export function densityFactor(count: number, pivot: number): number {
  if (!Number.isFinite(count) || count <= 0 || pivot <= 0) return 0;
  return Math.log1p(count) / Math.log1p(pivot);
}

export function clamp01(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 1 at the latest evidence. Earlier the same day decays. Live windows decay from now. */
export function recencyFactor(
  occurredAt: string | null,
  latestMs: number | null,
  live: boolean,
  now = Date.now(),
): number {
  if (!occurredAt) return 0.84;
  const time = Date.parse(occurredAt);
  if (!Number.isFinite(time)) return 0.84;
  if (live) {
    const ageH = Math.max(0, (now - time) / 3_600_000);
    return clamp01(Math.exp(-ageH / 8), 0.5, 1);
  }
  const ref = latestMs ?? time;
  const beforeH = Math.max(0, (ref - time) / 3_600_000);
  return clamp01(Math.exp(-beforeH / 10), 0.62, 1);
}

export function sizesAgree(meshIn: number, reportIn: number): boolean {
  if (meshIn < MIN_HAIL_IN || reportIn < MIN_HAIL_IN) return false;
  const ratio = Math.min(meshIn, reportIn) / Math.max(meshIn, reportIn);
  if (ratio >= 0.6) return true;
  return meshIn >= 1 && reportIn >= 1 && ratio >= 0.45;
}

export function confidenceFor(input: {
  meshIn: number | null;
  report: HailEvidence | null;
}): { factor: number; agreement: boolean; source: HoneySource; hailIn: number } {
  const mesh = input.meshIn != null && input.meshIn >= MIN_HAIL_IN ? input.meshIn : 0;
  const reportIn = input.report && input.report.sizeIn >= 0.5 ? input.report.sizeIn : 0;
  const report = reportIn > 0 ? input.report : null;
  const agreement = Boolean(report && sizesAgree(mesh, report.sizeIn));
  const hailIn = Math.round(Math.max(mesh, report?.sizeIn ?? 0) * 100) / 100;
  if (agreement && report) {
    return { factor: CONFIDENCE_WEIGHT.agreed, agreement: true, source: "agreed", hailIn };
  }
  if (report && report.confidence === "nws" && report.sizeIn >= mesh) {
    return { factor: CONFIDENCE_WEIGHT.nws, agreement: false, source: "nws", hailIn };
  }
  if (report && report.confidence === "spotter" && report.sizeIn >= mesh) {
    return { factor: CONFIDENCE_WEIGHT.spotter, agreement: false, source: "spotter", hailIn };
  }
  if (report && report.confidence === "community" && report.sizeIn > mesh) {
    return { factor: CONFIDENCE_WEIGHT.community, agreement: false, source: "community", hailIn };
  }
  if (mesh >= MIN_HAIL_IN) {
    return { factor: CONFIDENCE_WEIGHT.mesh, agreement: false, source: "mesh", hailIn: mesh };
  }
  if (report?.confidence === "nws") return { factor: CONFIDENCE_WEIGHT.nws, agreement: false, source: "nws", hailIn };
  if (report?.confidence === "spotter") return { factor: CONFIDENCE_WEIGHT.spotter, agreement: false, source: "spotter", hailIn };
  if (report) return { factor: CONFIDENCE_WEIGHT.community, agreement: false, source: "community", hailIn };
  return { factor: 0, agreement: false, source: "mesh", hailIn: 0 };
}

export function sourceLabel(source: HoneySource): string {
  if (source === "agreed") return "Radar and spotter agree";
  if (source === "nws") return "NWS report";
  if (source === "spotter") return "Spotter report";
  if (source === "community") return "Community report";
  return "Radar only";
}

export function scoreHoney(input: {
  mode: HoneyMode;
  hailIn: number;
  count: number;
  recency: number;
  confidence: number;
}): { raw: number; score: number; level: HoneyLevel } {
  const pivot = input.mode === "pdr" ? PDR_DENSITY_PIVOT : ROOF_DENSITY_PIVOT;
  const raw =
    hailWeight(input.hailIn) *
    densityFactor(input.count, pivot) *
    clamp01(input.recency, 0, 1) *
    clamp01(input.confidence, 0, 1);
  const score = raw > 0 ? Math.max(1, Math.min(100, Math.round(100 * (1 - Math.exp(-raw / 2.4))))) : 0;
  return { raw, score, level: levelForScore(score) };
}

export function boundsSpanKm(bounds: HoneyBounds): number {
  return haversineKm(bounds.south, bounds.west, bounds.north, bounds.east);
}

export function inBounds(lat: number, lon: number, bounds: HoneyBounds): boolean {
  return lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east;
}

export function roundBounds(bounds: HoneyBounds, step = 0.02): HoneyBounds {
  const floor = (value: number) => Math.floor(value / step) * step;
  const ceil = (value: number) => Math.ceil(value / step) * step;
  return {
    west: Math.round(floor(bounds.west) * 1e4) / 1e4,
    south: Math.round(floor(bounds.south) * 1e4) / 1e4,
    east: Math.round(ceil(bounds.east) * 1e4) / 1e4,
    north: Math.round(ceil(bounds.north) * 1e4) / 1e4,
  };
}

export function gridTiles(bounds: HoneyBounds, step = 0.36): HoneyBounds[] {
  const tiles: HoneyBounds[] = [];
  const west0 = Math.floor(bounds.west / step) * step;
  const south0 = Math.floor(bounds.south / step) * step;
  for (let south = south0; south < bounds.north - 1e-8; south += step) {
    for (let west = west0; west < bounds.east - 1e-8; west += step) {
      tiles.push({
        west: Math.round(west * 1e4) / 1e4,
        south: Math.round(south * 1e4) / 1e4,
        east: Math.round((west + step) * 1e4) / 1e4,
        north: Math.round((south + step) * 1e4) / 1e4,
      });
    }
  }
  return tiles;
}

export function latestEvidenceMs(reports: HailEvidence[]): number | null {
  let latest: number | null = null;
  for (const report of reports) {
    if (!report.occurredAt) continue;
    const time = Date.parse(report.occurredAt);
    if (!Number.isFinite(time)) continue;
    latest = latest == null ? time : Math.max(latest, time);
  }
  return latest;
}

export function matchReport(lat: number, lon: number, reports: HailEvidence[], radiusKm = REPORT_MATCH_KM): HailEvidence | null {
  let best: { report: HailEvidence; distance: number } | null = null;
  for (const report of reports) {
    const distance = haversineKm(lat, lon, report.lat, report.lon);
    if (distance > radiusKm) continue;
    if (!best || report.sizeIn > best.report.sizeIn + 0.2 || (report.sizeIn >= best.report.sizeIn - 0.05 && distance < best.distance)) {
      best = { report, distance };
    }
  }
  return best?.report ?? null;
}

const GENERIC_NAME = /^(parking|customer parking|parking lot|garage|car park|lot|unknown)$/i;

function usableName(name: string | null): string | null {
  const trimmed = name?.trim() ?? "";
  if (!trimmed || GENERIC_NAME.test(trimmed)) return null;
  return trimmed;
}

function clusterCount(members: ScoredPlace[], mode: HoneyMode): { vehicles: number; homes: number } {
  let measured = 0;
  let defaults = 0;
  let dealerDefaults = 0;
  let homes = 0;
  for (const member of members) {
    homes += member.homes;
    if (member.vehicleBasis === "area") measured += member.vehicles;
    else if (member.kind === "dealership" || member.kind === "fleet") dealerDefaults += member.vehicles;
    else defaults += member.vehicles;
  }
  const vehicles = measured >= 40 ? measured + dealerDefaults : measured + dealerDefaults + defaults;
  if (mode === "roof") return { vehicles, homes };
  return { vehicles, homes };
}

function clusterTitle(members: ScoredPlace[]): { name: string; kind: TargetKind } {
  const ranked = [...members].sort((a, b) => b.vehicles + b.homes - (a.vehicles + a.homes) || a.kind.localeCompare(b.kind));
  const kind = ranked[0]?.kind ?? "parking";
  const branded = ranked.find((member) => (member.kind === "dealership" || member.kind === "mall") && usableName(member.name));
  if (branded) {
    const name = usableName(branded.name) as string;
    const extra = members.length - 1;
    if (extra >= 3 && branded.kind === "dealership") return { name: `${name} row`, kind: branded.kind };
    if (extra >= 2 && branded.kind === "mall") return { name: `${name} area`, kind: branded.kind };
    return { name, kind: branded.kind };
  }
  const neighborhood = ranked.find((member) => member.neighborhood)?.neighborhood ?? null;
  const named = ranked.find((member) => usableName(member.name));
  if (named && usableName(named.name)) {
    const extra = members.length - 1;
    const name = usableName(named.name) as string;
    const genericLot = named.kind === "parking" && /parking|garage|\blot\b/i.test(name);
    const neighborhoodCount = members.filter((member) => member.neighborhood === neighborhood).length;
    if (genericLot && neighborhood && members.length >= 8 && neighborhoodCount * 2 >= members.length) return { name: neighborhood, kind };
    if (extra >= 2) return { name: `${name} area`, kind: named.kind };
    return { name, kind: named.kind };
  }
  if (neighborhood) return { name: neighborhood, kind };
  const city = ranked.find((member) => member.city)?.city;
  if (city) return { name: city, kind };
  return { name: kind === "homes" ? "Neighborhood" : "Hail pocket", kind };
}

export function clusterPlaces(places: ScoredPlace[], mode: HoneyMode, radiusKm = CLUSTER_RADIUS_KM): ScoredPlace[] {
  const remaining = [...places].sort((a, b) => b.vehicles + b.homes * 0.4 - (a.vehicles + a.homes * 0.4));
  const clusters: ScoredPlace[] = [];
  while (remaining.length) {
    const seed = remaining.shift();
    if (!seed) break;
    const members = [seed];
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      const candidate = remaining[i];
      if (haversineKm(seed.lat, seed.lon, candidate.lat, candidate.lon) <= radiusKm) {
        members.push(candidate);
        remaining.splice(i, 1);
      }
    }
    const totals = clusterCount(members, mode);
    const title = clusterTitle(members);
    const hailMember = members.reduce((best, member) => (member.hailIn > best.hailIn ? member : best), members[0]);
    let weight = 0;
    let lat = 0;
    let lon = 0;
    for (const member of members) {
      const mass = Math.max(1, member.vehicles + member.homes);
      weight += mass;
      lat += member.lat * mass;
      lon += member.lon * mass;
    }
    clusters.push({
      ...seed,
      id: members.map((member) => member.id).sort().join("+"),
      kind: title.kind,
      name: title.name,
      lat: lat / weight,
      lon: lon / weight,
      vehicles: totals.vehicles,
      homes: totals.homes,
      vehicleBasis: members.some((member) => member.vehicleBasis === "area") ? "area" : "default",
      hailIn: hailMember.hailIn,
      recency: hailMember.recency,
      confidence: hailMember.confidence,
      agreement: hailMember.agreement,
      source: hailMember.source,
      occurredAt: hailMember.occurredAt,
      neighborhood: members.find((member) => member.neighborhood)?.neighborhood ?? seed.neighborhood,
      city: members.find((member) => member.city)?.city ?? seed.city,
    });
  }
  return clusters;
}

export function toSpots(
  places: ScoredPlace[],
  mode: HoneyMode,
  origin: { lat: number; lon: number } | null,
  limit = 12,
): HoneySpot[] {
  const clustered = mode === "pdr" ? clusterPlaces(places, mode) : places;
  const spots: HoneySpot[] = [];
  for (const place of clustered) {
    const count = mode === "pdr" ? place.vehicles : place.homes;
    if (count <= 0 || place.hailIn < MIN_HAIL_IN) continue;
    const scored = scoreHoney({
      mode,
      hailIn: place.hailIn,
      count,
      recency: place.recency,
      confidence: place.confidence,
    });
    if (scored.score <= 0) continue;
    const name = usableName(place.name) ?? place.neighborhood ?? place.city ?? (mode === "roof" ? "Neighborhood" : "Hail pocket");
    spots.push({
      id: place.id,
      name,
      kind: place.kind,
      mode,
      lat: place.lat,
      lon: place.lon,
      hailIn: place.hailIn,
      vehicles: mode === "pdr" ? place.vehicles : place.vehicles || null,
      homes: mode === "roof" ? place.homes : place.homes || null,
      score: scored.score,
      raw: Math.round(scored.raw * 1000) / 1000,
      level: scored.level,
      distanceKm: origin ? Math.round(haversineKm(origin.lat, origin.lon, place.lat, place.lon) * 10) / 10 : null,
      agreement: place.agreement,
      source: place.source,
      sourceLabel: sourceLabel(place.source),
      memberCount: place.id.split("+").length,
    });
  }
  spots.sort((a, b) => b.raw - a.raw || b.hailIn - a.hailIn || (b.vehicles ?? 0) + (b.homes ?? 0) - ((a.vehicles ?? 0) + (a.homes ?? 0)));
  return disambiguateNames(spots.slice(0, limit));
}

function compass(north: number, east: number): string {
  const degrees = (Math.atan2(east, north) * 180) / Math.PI;
  const dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return dirs[Math.round((((degrees % 360) + 360) % 360) / 45) % 8];
}

function disambiguateNames(spots: HoneySpot[]): HoneySpot[] {
  const apply = (label: (spot: HoneySpot, group: HoneySpot[]) => string) => {
    const groups = new Map<string, HoneySpot[]>();
    for (const spot of spots) {
      const group = groups.get(spot.name) ?? [];
      group.push(spot);
      groups.set(spot.name, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const spot of group) spot.name = label(spot, group);
    }
  };
  apply((spot, group) => {
    const lat = group.reduce((sum, item) => sum + item.lat, 0) / group.length;
    const lon = group.reduce((sum, item) => sum + item.lon, 0) / group.length;
    return `${spot.name} ${compass(spot.lat - lat, spot.lon - lon)}`;
  });
  apply((spot) => {
    const tract = spot.id.match(/(?:^|\+)tract\/\d{5}(\d{4})(\d{2})(?:\+|$)/);
    if (!tract) return spot.name;
    const minor = tract[2] === "00" ? "" : `.${Number(tract[2])}`;
    return `${spot.name}, tract ${Number(tract[1])}${minor}`;
  });
  return spots;
}

export function honeyColor(score: number): { fill: string; opacity: number } {
  if (score >= 80) return { fill: "#9f1239", opacity: 0.58 };
  if (score >= 65) return { fill: "#e11d48", opacity: 0.52 };
  if (score >= 45) return { fill: "#ea580c", opacity: 0.48 };
  if (score >= 25) return { fill: "#d97706", opacity: 0.4 };
  return { fill: "#ca8a04", opacity: 0.32 };
}

export function circlePolygon(lat: number, lon: number, radiusKm: number, steps = 22): GeoJSON.Polygon {
  const ring: Array<[number, number]> = [];
  const latScale = 110.574;
  const lonScale = 111.32 * Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (i / steps) * Math.PI * 2;
    const dLat = (radiusKm / latScale) * Math.cos(bearing);
    const dLon = (radiusKm / (lonScale || 1)) * Math.sin(bearing);
    ring.push([Math.round((lon + dLon) * 1e5) / 1e5, Math.round((lat + dLat) * 1e5) / 1e5]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

export function heatRadiusKm(mode: HoneyMode, count: number): number {
  const pivot = mode === "pdr" ? 180 : 900;
  const extra = Math.log1p(Math.max(0, count)) / Math.log1p(pivot);
  return Math.max(0.7, Math.min(2.1, 0.75 + extra * 0.7));
}

export function spotsToHeat(spots: HoneySpot[], mode: HoneyMode): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const ordered = spots.map((spot, index) => ({ spot, rank: index + 1 })).reverse();
  for (const { spot, rank } of ordered) {
    const count = mode === "pdr" ? spot.vehicles ?? 0 : spot.homes ?? 0;
    const color = honeyColor(spot.score);
    features.push({
      type: "Feature",
      id: `${spot.id}-heat`,
      properties: {
        id: spot.id,
        rank,
        name: spot.name,
        score: spot.score,
        fill: color.fill,
        opacity: color.opacity,
        kind: "heat",
      },
      geometry: circlePolygon(spot.lat, spot.lon, heatRadiusKm(mode, count)),
    });
    features.push({
      type: "Feature",
      id: `${spot.id}-pin`,
      properties: {
        id: spot.id,
        rank,
        name: spot.name,
        score: spot.score,
        fill: color.fill,
        kind: "pin",
      },
      geometry: { type: "Point", coordinates: [Math.round(spot.lon * 1e5) / 1e5, Math.round(spot.lat * 1e5) / 1e5] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function emptyHeat(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

export function scorePlaces(
  places: HoneyPlace[],
  reports: HailEvidence[],
  meshAt: (lat: number, lon: number) => number | null,
  live: boolean,
  now = Date.now(),
): ScoredPlace[] {
  const latest = latestEvidenceMs(reports);
  const scored: ScoredPlace[] = [];
  for (const place of places) {
    const meshIn = meshAt(place.lat, place.lon);
    const report = matchReport(place.lat, place.lon, reports);
    const confidence = confidenceFor({ meshIn, report });
    if (confidence.hailIn < MIN_HAIL_IN) continue;
    scored.push({
      ...place,
      hailIn: confidence.hailIn,
      recency: recencyFactor(report?.occurredAt ?? null, latest, live, now),
      confidence: confidence.factor,
      agreement: confidence.agreement,
      source: confidence.source,
      occurredAt: report?.occurredAt ?? null,
    });
  }
  return scored;
}
