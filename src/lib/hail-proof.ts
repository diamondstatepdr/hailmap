import { buildPdf, pdfText, wrapPdfText } from "@/lib/pdf-doc";

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
  maxHailIn: number | null;
  score: number;
  level: string;
  summary: string;
  storms: ProofStorm[];
  nearby: ProofNearby[];
  rings: number[][][];
  createdAt: string;
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
  const rings = Array.isArray(row.rings) ? row.rings : [];
  return {
    address,
    lat,
    lon,
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
    rings: rings.slice(0, 6).flatMap((ring) => {
      const next = ringOf(ring);
      return next ? [next] : [];
    }),
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

function proofBounds(proof: HailProof): Box {
  let west = proof.lon - 0.08;
  let east = proof.lon + 0.08;
  let south = proof.lat - 0.06;
  let north = proof.lat + 0.06;
  for (const ring of proof.rings) {
    for (const [lon, lat] of ring) {
      if (Math.abs(lon - proof.lon) > 0.6 || Math.abs(lat - proof.lat) > 0.45) continue;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  const lonSpan = Math.max(0.06, east - west);
  const latSpan = Math.max(0.04, north - south);
  return {
    west: west - lonSpan * 0.12,
    east: east + lonSpan * 0.12,
    south: south - latSpan * 0.12,
    north: north + latSpan * 0.12,
  };
}

function project(bounds: Box, frame: { x: number; y: number; w: number; h: number }, lon: number, lat: number) {
  const x = frame.x + ((lon - bounds.west) / (bounds.east - bounds.west)) * frame.w;
  const y = frame.y + ((lat - bounds.south) / (bounds.north - bounds.south)) * frame.h;
  return { x, y };
}

export function proofMapSvg(proof: HailProof): string {
  const width = 640;
  const height = 280;
  const bounds = proofBounds(proof);
  const frame = { x: 0, y: 0, w: width, h: height };
  const xy = (lon: number, lat: number) => {
    const point = project(bounds, frame, lon, lat);
    return { x: point.x, y: height - point.y };
  };
  const polygons = proof.rings
    .map((ring) => {
      const d = ring
        .map(([lon, lat], index) => {
          const point = xy(lon, lat);
          return `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        })
        .join(" ");
      return `<path d="${d} Z" fill="#9d174d" fill-opacity="0.28" stroke="#9d174d" stroke-width="1.5"/>`;
    })
    .join("");
  const pin = xy(proof.lon, proof.lat);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Swath map">
    <rect width="${width}" height="${height}" fill="#eef3fb"/>
    ${polygons}
    <circle cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="7" fill="#0b1f6e" stroke="#ffffff" stroke-width="2"/>
    <text x="16" y="24" fill="#3e4c66" font-family="Inter, Segoe UI, sans-serif" font-size="13">Swath map · address pin</text>
  </svg>`;
}

function text(font: "F1" | "F2", size: number, x: number, y: number, value: string, color = "0.07 0.12 0.22") {
  return `BT /${font} ${size} Tf ${color} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(value)}) Tj ET\n`;
}

export function renderHailProofPdf(proof: HailProof): Buffer {
  const hailLine = proof.maxHailIn != null ? `${proof.maxHailIn.toFixed(2)} in` : "No hail size";
  const dates = proof.storms.map((storm) => storm.label || storm.date).join(", ") || "No storm date in this view";
  const bounds = proofBounds(proof);
  const frame = { x: 36, y: 392, w: 540, h: 210 };
  let map = "q 0.93 0.95 0.98 rg 36 392 540 210 re f Q\n";
  map += "0.62 0.09 0.30 RG 0.95 0.86 0.90 rg\n";
  for (const ring of proof.rings) {
    ring.forEach(([lon, lat], index) => {
      const point = project(bounds, frame, lon, lat);
      map += `${point.x.toFixed(1)} ${point.y.toFixed(1)} ${index === 0 ? "m" : "l"} `;
    });
    map += "h f S\n";
  }
  const pin = project(bounds, frame, proof.lon, proof.lat);
  map += `0.04 0.12 0.43 rg ${pin.x.toFixed(1)} ${pin.y.toFixed(1)} 5 0 360 arc f\n`;
  map += text("F1", 9, 48, 582, "Swath map", "0.24 0.30 0.40");

  const summary = wrapPdfText(proof.summary, 92).slice(0, 3);
  let nearby = "";
  proof.nearby.slice(0, 6).forEach((report, index) => {
    const y = 348 - index * 16;
    nearby += text("F1", 9, 40, y, `${report.when}   ${report.detail}   ${report.where}`.slice(0, 96));
  });
  if (!proof.nearby.length) nearby = text("F1", 9, 40, 348, "No nearby reports in this view.");

  const content = [
    "0.04 0.12 0.43 rg 0 720 612 72 re f\n",
    text("F2", 18, 36, 756, "SWATHLINE", "1 1 1"),
    text("F1", 11, 36, 736, "Hail proof", "0.85 0.91 1"),
    text("F1", 9, 430, 748, "Estimate", "1 1 1"),
    text("F2", 16, 36, 688, proof.address.slice(0, 70)),
    text("F1", 10, 36, 668, `${proof.lat.toFixed(5)}, ${proof.lon.toFixed(5)}`, "0.28 0.35 0.46"),
    "0.96 0.97 0.99 rg 36 612 540 42 re f\n",
    text("F1", 9, 48, 632, "Max hail"),
    text("F2", 12, 48, 616, hailLine),
    text("F1", 9, 190, 632, "Damage score"),
    text("F2", 12, 190, 616, `${proof.level} · ${proof.score}/100`),
    text("F1", 9, 360, 632, "Storm dates"),
    text("F2", 10, 360, 616, dates.slice(0, 42)),
    map,
    text("F2", 11, 36, 368, "Nearby reports"),
    nearby,
    text("F2", 11, 36, 250, "Damage score"),
    ...summary.map((line, index) => text("F1", 10, 36, 232 - index * 14, line, "0.24 0.30 0.40")),
    text("F1", 8, 36, 78, "This is an estimate from Swathline storm evidence. It is not a roof inspection,"),
    text("F1", 8, 36, 66, "an insurance decision, or a guarantee that hail damaged this address."),
    text("F1", 8, 36, 48, `Prepared ${proof.createdAt.slice(0, 10)} · Radar hail and official storm reports`),
  ].join("");
  return buildPdf(content);
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

export function ringsNearPoint(
  features: Array<{ geometry?: { type?: string; coordinates?: unknown } | null }>,
  lat: number,
  lon: number,
): number[][][] {
  const rings: number[][][] = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    const polygons =
      geometry?.type === "Polygon"
        ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon"
          ? (geometry.coordinates as unknown[])
          : [];
    for (const polygon of polygons) {
      if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
      const ring = polygon[0] as unknown[];
      const close = ring.some((pair) => {
        if (!Array.isArray(pair)) return false;
        return Math.abs(Number(pair[0]) - lon) < 0.4 && Math.abs(Number(pair[1]) - lat) < 0.3;
      });
      if (!close) continue;
      const step = Math.max(1, Math.ceil(ring.length / 60));
      const simplified = ring.filter((_, index) => index % step === 0).slice(0, 60);
      const next = ringOf(simplified);
      if (next) rings.push(next);
      if (rings.length >= 5) return rings;
    }
  }
  return rings;
}
