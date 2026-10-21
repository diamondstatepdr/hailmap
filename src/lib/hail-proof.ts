import { pointInGeometry } from "@/lib/geo";
import { MESH_LEGEND } from "@/lib/mesh-legend";
import { measureGeometry, readoutForSelection, statLine } from "@/lib/swath-measure";

export interface ProofStorm {
  date: string;
  label: string;
  hailIn: number | null;
}

export interface ProofNearby {
  when: string;
  where: string;
  detail: string;
}

export interface HailProof {
  address: string;
  lat: number;
  lon: number;
  company: string;
  phone: string;
  maxHailIn: number | null;
  score: number;
  level: string;
  summary: string;
  storms: ProofStorm[];
  nearby: ProofNearby[];
  rings: number[][][];
  colors: string[];
  /** Length, width, and area from the full swath, matching the swath sheet. */
  swathLine: string;
  createdAt: string;
}

/** A street-scale frame around the address, about a mile and a half across. */
export function streetFrame(lat: number, lon: number): Box {
  const latPad = 0.0085;
  const lonPad = 0.0085 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  return { west: lon - lonPad, east: lon + lonPad, south: lat - latPad, north: lat + latPad };
}

const LEVELS = new Set(["Low", "Moderate", "High", "Very High"]);

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function hail(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 8) return null;
  return Math.round(n * 100) / 100;
}

function ringOf(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const ring: number[][] = [];
  for (const pair of value.slice(0, 80)) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    ring.push([lon, lat]);
  }
  return ring.length >= 3 ? ring : null;
}

export function normalizeProof(input: unknown, createdAt = new Date().toISOString()): HailProof | { error: string } {
  const row = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const address = clip(row.address, 160);
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (address.length < 2) return { error: "An address is required." };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { error: "A map location is required." };
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(row.score) || 0)));
  const levelRaw = clip(row.level, 20);
  const storms = Array.isArray(row.storms) ? row.storms : [];
  const nearby = Array.isArray(row.nearby) ? row.nearby : [];
  const colors = (Array.isArray(row.colors) ? row.colors : []).flatMap((value) => {
    const color = clip(value, 7);
    return /^#[0-9a-fA-F]{6}$/.test(color) ? [color.toLowerCase()] : [];
  });
  const rings = (Array.isArray(row.rings) ? row.rings : []).slice(0, 6).flatMap((ring) => {
    const next = ringOf(ring);
    return next ? [next] : [];
  });
  return {
    address,
    lat,
    lon,
    company: clip(row.company, 80),
    phone: clip(row.phone, 40),
    maxHailIn: hail(row.maxHailIn),
    score,
    level: LEVELS.has(levelRaw) ? levelRaw : "Low",
    summary: clip(row.summary, 280) || "Damage score from nearby hail, wind, tornado, and radar evidence.",
    storms: storms.slice(0, 8).flatMap((item) => {
      const storm = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const date = clip(storm.date, 20);
      const label = clip(storm.label, 40) || date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
      return [{ date, label, hailIn: hail(storm.hailIn) }];
    }),
    nearby: nearby.slice(0, 8).flatMap((item) => {
      const report = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const detail = clip(report.detail, 80);
      const where = clip(report.where, 80);
      const when = clip(report.when, 40);
      if (!detail && !where) return [];
      return [{ when: when || "—", where: where || "Nearby", detail: detail || "Report" }];
    }),
    rings,
    colors: rings.map((_, index) => colors[index] || "#f97316"),
    swathLine: clip(row.swathLine, 120),
    createdAt,
  };
}

export function proofFilename(address: string): string {
  const slug = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `Swathline-hail-proof${slug ? `-${slug}` : ""}.pdf`;
}

interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

function project(bounds: Box, frame: { x: number; y: number; w: number; h: number }, lon: number, lat: number) {
  const x = frame.x + ((lon - bounds.west) / (bounds.east - bounds.west)) * frame.w;
  const y = frame.y + ((lat - bounds.south) / (bounds.north - bounds.south)) * frame.h;
  return { x, y };
}

/** Length, width, and area of the largest stored swath ring. */
export function proofSwathStat(rings: number[][][]): string | null {
  let best: ReturnType<typeof measureGeometry> | null = null;
  for (const ring of rings) {
    if (ring.length < 4) continue;
    const stats = measureGeometry({ type: "Polygon", coordinates: [ring] });
    if (!best || stats.areaSqMi > best.areaSqMi) best = stats;
  }
  if (!best || (best.areaSqMi <= 0 && best.lengthMi <= 0)) return null;
  return statLine(best);
}

export function proofMapSvg(proof: HailProof): string {
  const width = 640;
  const height = 280;
  const bounds = streetFrame(proof.lat, proof.lon);
  const frame = { x: 0, y: 0, w: width, h: height };
  const xy = (lon: number, lat: number) => {
    const point = project(bounds, frame, lon, lat);
    return { x: point.x, y: height - point.y };
  };
  const polygons = proof.rings
    .map((ring, index) => {
      const color = proof.colors[index] || "#f97316";
      const d = ring
        .map(([lon, lat], indexPoint) => {
          const point = xy(lon, lat);
          return `${indexPoint === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        })
        .join(" ");
      return `<path d="${d} Z" fill="${color}" fill-opacity="0.4" stroke="#102033" stroke-width="2"/>`;
    })
    .join("");
  const pin = xy(proof.lon, proof.lat);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Swath map">
    <rect width="${width}" height="${height}" fill="#e7eef5"/>
    ${polygons}
    <circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="7" fill="#0b1f6e" stroke="#ffffff" stroke-width="2"/>
    <text x="16" y="24" fill="#3e4c66" font-family="Inter, Segoe UI, sans-serif" font-size="13">Swath map · address pin</text>
  </svg>`;
}

export function stormsFromDaily(
  events: Array<{ date: string; label: string; meshMaxIn?: number | null; spotterMaxIn?: number | null }>,
): ProofStorm[] {
  return events
    .map((event) => {
      const hailIn = Math.max(event.meshMaxIn ?? 0, event.spotterMaxIn ?? 0);
      return { date: event.date, label: event.label || event.date, hailIn: hailIn > 0 ? Math.round(hailIn * 100) / 100 : null };
    })
    .filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(event.date) && event.hailIn != null)
    .sort((a, b) => (b.hailIn ?? 0) - (a.hailIn ?? 0) || b.date.localeCompare(a.date))
    .slice(0, 8);
}

export function nearbyLines(
  reports: Array<{ when: string; where: string; detail: string }>,
): ProofNearby[] {
  return reports
    .map((report) => ({
      when: report.when.trim().slice(0, 40) || "—",
      where: report.where.trim().slice(0, 80) || "Nearby",
      detail: report.detail.trim().slice(0, 80) || "Report",
    }))
    .filter((report) => report.detail !== "Report" || report.where !== "Nearby")
    .slice(0, 8);
}

function bandColor(properties: Record<string, unknown> | null, minIn: number | null): string {
  const color = typeof properties?.color === "string" ? properties.color : "";
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase();
  const match = [...MESH_LEGEND].reverse().find((band) => minIn != null && minIn + 0.001 >= band.minIn);
  return match?.color ?? "#f97316";
}

function frameHit(geometry: GeoJSON.Geometry, lat: number, lon: number): boolean {
  if (pointInGeometry(lon, lat, geometry)) return true;
  const frame = streetFrame(lat, lon);
  const corners: Array<[number, number]> = [
    [frame.west, frame.south],
    [frame.east, frame.south],
    [frame.east, frame.north],
    [frame.west, frame.north],
  ];
  return corners.some(([cornerLon, cornerLat]) => pointInGeometry(cornerLon, cornerLat, geometry));
}

export interface ProofBand {
  ring: number[][];
  color: string;
  minIn: number | null;
}

/** Bands that cover the address or cross the street frame, lightest first. */
export function ringsNearPoint(
  features: Array<{ geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> | null }>,
  lat: number,
  lon: number,
): ProofBand[] {
  const bands: ProofBand[] = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    if (!frameHit(geometry as GeoJSON.Geometry, lat, lon)) continue;
    const polygons = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates) as unknown[];
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
      const ring = polygon[0] as unknown[];
      const step = Math.max(1, Math.ceil(ring.length / 80));
      const simplified = ring.filter((_, index) => index % step === 0).slice(0, 80);
      const next = ringOf(simplified);
      if (!next) continue;
      const minIn = Number(feature.properties?.minIn);
      bands.push({
        ring: next,
        color: bandColor(feature.properties ?? null, Number.isFinite(minIn) ? minIn : null),
        minIn: Number.isFinite(minIn) ? minIn : null,
      });
      break;
    }
  }
  return bands.sort((a, b) => (a.minIn ?? 0) - (b.minIn ?? 0)).slice(0, 6);
}

/** The swath sheet's total for the storm covering this address, from the full polygons. */
export function swathCaptionNearPoint(
  features: Array<{ geometry?: GeoJSON.Geometry | null; properties?: Record<string, unknown> | null }>,
  lat: number,
  lon: number,
): string {
  let best: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; properties?: Record<string, unknown> | null } | null = null;
  let bestArea = -1;
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    if (!pointInGeometry(lon, lat, geometry)) continue;
    const area = measureGeometry(geometry).areaSqMi;
    if (area > bestArea) {
      best = { geometry, properties: feature.properties };
      bestArea = area;
    }
  }
  if (!best) return "";
  const minIn = Number(best.properties?.minIn ?? best.properties?.maxSizeIn);
  const maxIn = Number(best.properties?.maxIn ?? best.properties?.maxSizeIn);
  const readout = readoutForSelection(
    {
      geometry: best.geometry,
      minIn: Number.isFinite(minIn) ? minIn : null,
      maxIn: Number.isFinite(maxIn) ? maxIn : null,
    },
    features,
  );
  if (readout.total.lengthMi <= 0 && readout.total.areaSqMi <= 0) return "";
  return statLine(readout.total);
}
