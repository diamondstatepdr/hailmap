import { classifyObservation } from "@/lib/confidence";
import { parseCsv } from "@/lib/csv";
import { ringSpanKm, validLatLon } from "@/lib/geo";
import { stableId } from "@/lib/ids";
import { parseHailSizeInches, parseSpcSizeToken } from "@/lib/size";
import type { IncomingReport } from "@/lib/types";

export function convectiveDay(now = new Date()): string {
  const date = new Date(now.getTime());
  if (date.getUTCHours() < 12) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function addUtcDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function spcFileStamp(isoDate: string): string {
  return `${isoDate.slice(2, 4)}${isoDate.slice(5, 7)}${isoDate.slice(8, 10)}`;
}

/** SPC convective day starts at 12:00 UTC. Times before 12:00 UTC belong to the next calendar date. */
export function spcTimeToIso(convectiveDate: string, hhmm: string): string | null {
  if (!/^\d{4}$/.test(hhmm)) return null;
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2, 4));
  if (hour > 23 || minute > 59) return null;
  const [year, month, day] = convectiveDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  if (hour < 12) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function clip(value: string | null, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function parseSpcHailCsv(csv: string, convectiveDate: string): IncomingReport[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  const reports: IncomingReport[] = [];
  for (const cols of rows) {
    if (cols.length < 7) continue;
    if (/^time$/i.test(cols[0].trim())) continue;
    let hhmm = cols[0].trim();
    if (/^\d{3}$/.test(hhmm)) hhmm = `0${hhmm}`;
    const occurredAt = spcTimeToIso(convectiveDate, hhmm);
    const sizeRaw = cols[1]?.trim() || null;
    const sizeIn = sizeRaw ? parseSpcSizeToken(sizeRaw) : null;
    const lat = Number(cols[5]);
    const lon = Number(cols[6]);
    if (!occurredAt || !validLatLon(lat, lon) || sizeIn == null) continue;
    const remark = clip(cols.slice(7).join(","), 2000);
    const state = clip(cols[4], 32);
    reports.push({
      source: "spc",
      externalId: stableId(["spc", occurredAt, lat.toFixed(3), lon.toFixed(3), sizeIn]),
      confidence: classifyObservation(cols[7] ?? "", remark),
      lat,
      lon,
      sizeIn,
      sizeRaw,
      occurredAt,
      location: clip(cols[2], 200),
      county: clip(cols[3], 120),
      state: state && state.length === 2 ? state.toUpperCase() : state,
      remark,
    });
  }
  return reports;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function parseIemGeoJson(payload: unknown): IncomingReport[] {
  const root = asRecord(payload);
  const features = root?.features;
  if (!Array.isArray(features)) return [];
  const reports: IncomingReport[] = [];
  for (const feature of features) {
    const record = asRecord(feature);
    const props = asRecord(record?.properties) ?? {};
    const typeText = String(props.typetext ?? "").toUpperCase();
    const typeCode = String(props.type ?? "").toUpperCase();
    if (typeText) {
      if (typeText !== "HAIL") continue;
    } else if (typeCode !== "H") {
      continue;
    }
    const geometry = asRecord(record?.geometry);
    let lat = Number(props.lat);
    let lon = Number(props.lon);
    if (geometry?.type === "Point" && Array.isArray(geometry.coordinates)) {
      lon = Number(geometry.coordinates[0]);
      lat = Number(geometry.coordinates[1]);
    }
    if (!validLatLon(lat, lon)) continue;
    const occurred = new Date(String(props.valid ?? ""));
    if (Number.isNaN(occurred.getTime())) continue;
    let sizeIn = typeof props.magf === "number" ? props.magf : parseHailSizeInches(props.magnitude);
    const unit = String(props.unit ?? "");
    if (sizeIn != null && /mm/i.test(unit)) sizeIn = sizeIn / 25.4;
    sizeIn = sizeIn == null ? null : parseHailSizeInches(sizeIn);
    const sourceText = props.source == null ? null : String(props.source);
    const remark = props.remark == null ? null : String(props.remark);
    const stateRaw = String(props.st ?? props.state ?? "").trim();
    reports.push({
      source: "iem",
      externalId: String(props.product_id ?? stableId(["iem", occurred.toISOString(), lat, lon, sizeIn])),
      confidence: classifyObservation(sourceText, remark),
      lat,
      lon,
      sizeIn,
      sizeRaw: props.magnitude == null ? (sizeIn == null ? null : String(sizeIn)) : String(props.magnitude),
      occurredAt: occurred.toISOString(),
      location: clip(props.city == null ? null : String(props.city), 200),
      county: clip(props.county == null ? null : String(props.county), 120),
      state: stateRaw ? (stateRaw.length === 2 ? stateRaw.toUpperCase() : stateRaw.slice(0, 32)) : null,
      remark: clip(remark, 2000),
    });
  }
  return reports;
}

function outerRing(geometry: unknown): Array<[number, number]> | null {
  const record = asRecord(geometry);
  if (!record) return null;
  if (record.type === "Point" && Array.isArray(record.coordinates)) {
    return [[Number(record.coordinates[0]), Number(record.coordinates[1])]];
  }
  if (record.type === "Polygon" && Array.isArray(record.coordinates)) {
    const ring = record.coordinates[0];
    return Array.isArray(ring) ? (ring as Array<[number, number]>) : null;
  }
  if (record.type === "MultiPolygon" && Array.isArray(record.coordinates)) {
    const ring = (record.coordinates as unknown[][])[0]?.[0];
    return Array.isArray(ring) ? (ring as Array<[number, number]>) : null;
  }
  if (record.type === "GeometryCollection" && Array.isArray(record.geometries)) {
    for (const child of record.geometries) {
      const ring = outerRing(child);
      if (ring) return ring;
    }
  }
  return null;
}

function centroid(ring: Array<[number, number]>): { lon: number; lat: number } | null {
  const open =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  if (!open.length) return null;
  const lon = open.reduce((sum, pair) => sum + Number(pair[0]), 0) / open.length;
  const lat = open.reduce((sum, pair) => sum + Number(pair[1]), 0) / open.length;
  return validLatLon(lat, lon) ? { lat, lon } : null;
}

function hailFromAlert(props: Record<string, unknown>): { sizeIn: number | null; sizeRaw: string | null } {
  const params = asRecord(props.parameters);
  if (params) {
    for (const [key, values] of Object.entries(params)) {
      if (!/hail/i.test(key)) continue;
      const list = Array.isArray(values) ? values : [values];
      for (const value of list) {
        const sizeIn = parseHailSizeInches(value);
        if (sizeIn) return { sizeIn, sizeRaw: String(value) };
      }
    }
  }
  const text = `${props.description ?? ""}\n${props.headline ?? ""}`;
  const patterns = [
    /MAX HAIL SIZE\.{1,}\s*([0-9]+(?:\.[0-9]+)?)\s*IN/i,
    /HAIL(?:\s+SIZE)?\.{1,}\s*([0-9]+(?:\.[0-9]+)?)\s*IN/i,
    /hail(?:\s+size)?(?:\s+of|\s+up\s+to)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:inch(?:es)?|in\b|")/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const sizeIn = parseHailSizeInches(match[1]);
    if (sizeIn) return { sizeIn, sizeRaw: match[1] };
  }
  return { sizeIn: null, sizeRaw: null };
}

export function parseNwsAlerts(payload: unknown): IncomingReport[] {
  const root = asRecord(payload);
  const features = root?.features;
  if (!Array.isArray(features)) return [];
  const reports: IncomingReport[] = [];
  for (const feature of features) {
    const record = asRecord(feature);
    const props = asRecord(record?.properties);
    if (!props) continue;
    const blob = `${props.event ?? ""} ${props.headline ?? ""} ${props.description ?? ""}`;
    if (!/hail/i.test(blob)) continue;
    const { sizeIn, sizeRaw } = hailFromAlert(props);
    if (sizeIn == null) continue;
    const ring = outerRing(record?.geometry);
    if (!ring || ringSpanKm(ring) > 300) continue;
    const center = centroid(ring);
    if (!center) continue;
    const when = new Date(String(props.onset ?? props.effective ?? props.sent ?? ""));
    if (Number.isNaN(when.getTime())) continue;
    const id = String(props.id ?? record?.id ?? stableId(["nws", when.toISOString(), center.lat, center.lon]));
    reports.push({
      source: "nws",
      externalId: id,
      confidence: "nws",
      lat: center.lat,
      lon: center.lon,
      sizeIn,
      sizeRaw,
      occurredAt: when.toISOString(),
      location: clip(props.areaDesc == null ? null : String(props.areaDesc), 200),
      county: null,
      state: null,
      remark: clip(
        `NWS warning centroid. ${props.headline ?? ""}`.trim(),
        2000,
      ),
    });
  }
  return reports;
}

export function parseMeshGeoJson(payload: unknown): IncomingReport[] {
  const root = asRecord(payload);
  const features =
    root?.type === "FeatureCollection" && Array.isArray(root.features)
      ? root.features
      : root?.type === "Feature"
        ? [root]
        : [];
  const reports: IncomingReport[] = [];
  for (const feature of features) {
    const record = asRecord(feature);
    if (!record) continue;
    const props = asRecord(record.properties) ?? {};
    const ring = outerRing(record.geometry);
    const center = ring ? centroid(ring) : null;
    if (!center) continue;
    const rawSize = props.mesh ?? props.MESH ?? props.sizeIn ?? props.size ?? props.mean ?? props.magnitude;
    const sizeIn = parseHailSizeInches(rawSize);
    const when = new Date(String(props.time ?? props.valid ?? props.occurredAt ?? new Date().toISOString()));
    if (Number.isNaN(when.getTime())) continue;
    reports.push({
      source: "mesh",
      externalId: String(props.id ?? record.id ?? stableId(["mesh", when.toISOString(), center.lat, center.lon, sizeIn])),
      confidence: "mesh",
      lat: center.lat,
      lon: center.lon,
      sizeIn,
      sizeRaw: rawSize == null ? null : String(rawSize),
      occurredAt: when.toISOString(),
      location: clip(props.location == null ? null : String(props.location), 200),
      county: clip(props.county == null ? null : String(props.county), 120),
      state: clip(props.state == null ? null : String(props.state), 32),
      remark: clip(props.remark == null ? "MRMS MESH" : String(props.remark), 2000),
    });
  }
  return reports;
}
