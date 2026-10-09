import { classifyOfficialLsr } from "@/lib/confidence";
import { parseCsv } from "@/lib/csv";
import { ringSpanKm, validLatLon } from "@/lib/geo";
import { parseEfRating, parseWindMph, type Hazard } from "@/lib/hazard";
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

/** IEM LSR type text/code to a hazard HailMap stores. Other LSR types are ignored. */
export function iemHazard(typeText: string, typeCode: string): Hazard | null {
  const text = typeText.toUpperCase();
  const code = typeCode.toUpperCase();
  if (text.includes("HAIL") || (!text && code === "H")) return "hail";
  if (text.includes("TORNADO") || (!text && code === "T") || code === "T") return "tornado";
  if (
    text.includes("WND") ||
    text.includes("WIND") ||
    code === "G" ||
    code === "D" ||
    code === "M" ||
    code === "N" ||
    code === "O"
  ) {
    return "wind";
  }
  return null;
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
      confidence: classifyOfficialLsr(null, remark),
      hazard: "hail",
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

function spcRows(csv: string): string[][] {
  return parseCsv(csv.replace(/^\uFEFF/, "")).filter((cols) => cols.length >= 7 && !/^time$/i.test(cols[0].trim()));
}

function spcWhen(cols: string[], convectiveDate: string): { occurredAt: string; lat: number; lon: number } | null {
  let hhmm = cols[0].trim();
  if (/^\d{3}$/.test(hhmm)) hhmm = `0${hhmm}`;
  const occurredAt = spcTimeToIso(convectiveDate, hhmm);
  const lat = Number(cols[5]);
  const lon = Number(cols[6]);
  if (!occurredAt || !validLatLon(lat, lon)) return null;
  return { occurredAt, lat, lon };
}

function spcPlace(cols: string[]) {
  const state = clip(cols[4], 32);
  return {
    location: clip(cols[2], 200),
    county: clip(cols[3], 120),
    state: state && state.length === 2 ? state.toUpperCase() : state,
    remark: clip(cols.slice(7).join(","), 2000),
  };
}

/** SPC wind LSR file: speed is miles per hour. UNK is kept with a null speed. */
export function parseSpcWindCsv(csv: string, convectiveDate: string): IncomingReport[] {
  const reports: IncomingReport[] = [];
  for (const cols of spcRows(csv)) {
    const when = spcWhen(cols, convectiveDate);
    if (!when) continue;
    const token = cols[1]?.trim() || "";
    const windMph = parseWindMph(token, "MPH");
    const place = spcPlace(cols);
    reports.push({
      source: "spc",
      externalId: stableId(["spc", "wind", when.occurredAt, when.lat.toFixed(3), when.lon.toFixed(3), windMph]),
      confidence: classifyOfficialLsr(null, place.remark),
      hazard: "wind",
      lat: when.lat,
      lon: when.lon,
      sizeIn: null,
      sizeRaw: token || null,
      windMph,
      occurredAt: when.occurredAt,
      ...place,
    });
  }
  return reports;
}

/** SPC tornado LSR file. The scale column is EF/F/UNK when the office published one. */
export function parseSpcTornadoCsv(csv: string, convectiveDate: string): IncomingReport[] {
  const reports: IncomingReport[] = [];
  for (const cols of spcRows(csv)) {
    const when = spcWhen(cols, convectiveDate);
    if (!when) continue;
    const token = cols[1]?.trim() || "";
    const efRating = parseEfRating(token);
    const place = spcPlace(cols);
    reports.push({
      source: "spc",
      externalId: stableId(["spc", "tornado", when.occurredAt, when.lat.toFixed(3), when.lon.toFixed(3), efRating]),
      confidence: classifyOfficialLsr(null, place.remark),
      hazard: "tornado",
      lat: when.lat,
      lon: when.lon,
      sizeIn: null,
      sizeRaw: token || null,
      efRating,
      occurredAt: when.occurredAt,
      ...place,
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
    const hazard = iemHazard(typeText, typeCode);
    if (!hazard) continue;
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
    const unit = String(props.unit ?? "");
    let sizeIn: number | null = null;
    let windMph: number | null = null;
    let efRating: string | null = null;
    if (hazard === "hail") {
      sizeIn = typeof props.magf === "number" ? props.magf : parseHailSizeInches(props.magnitude);
      if (sizeIn != null && /mm/i.test(unit)) sizeIn = sizeIn / 25.4;
      sizeIn = sizeIn == null ? null : parseHailSizeInches(sizeIn);
    } else if (hazard === "wind") {
      const raw = typeof props.magf === "number" ? props.magf : props.magnitude;
      windMph = parseWindMph(raw, unit);
    } else {
      efRating =
        parseEfRating(props.magnitude) ??
        parseEfRating(props.magf) ??
        parseEfRating(props.remark);
    }
    const sourceText = props.source == null ? null : String(props.source);
    const remark = props.remark == null ? null : String(props.remark);
    const stateRaw = String(props.st ?? props.state ?? "").trim();
    const idParts: Array<string | number | null> = [
      "iem",
      props.product_id == null ? "" : String(props.product_id),
      occurred.toISOString(),
      lat,
      lon,
      sizeIn,
      props.city == null ? "" : String(props.city),
    ];
    if (hazard !== "hail") idParts.push(hazard, windMph, efRating);
    reports.push({
      source: "iem",
      // product_id is the LSR bulletin, which often lists several cities. Keying
      // only on it kept the last report in the product and dropped the rest
      // (Salt Lake Holladay was overwritten by Spanish Fork).
      externalId: stableId(idParts),
      confidence: classifyOfficialLsr(sourceText, remark),
      hazard,
      lat,
      lon,
      sizeIn,
      sizeRaw:
        hazard === "wind"
          ? windMph == null
            ? null
            : String(windMph)
          : hazard === "tornado"
            ? efRating
            : props.magnitude == null
              ? sizeIn == null
                ? null
                : String(sizeIn)
              : String(props.magnitude),
      windMph,
      efRating,
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

function windFromAlert(props: Record<string, unknown>): number | null {
  const params = asRecord(props.parameters);
  if (params) {
    for (const [key, values] of Object.entries(params)) {
      if (!/wind|gust/i.test(key)) continue;
      const list = Array.isArray(values) ? values : [values];
      for (const value of list) {
        const mph = parseWindMph(value, /kt|knot/i.test(String(value)) || /kt|knot/i.test(key) ? "KT" : "MPH");
        if (mph) return mph;
      }
    }
  }
  const text = `${props.description ?? ""}\n${props.headline ?? ""}`;
  const patterns = [
    /MAX(?:IMUM)? WIND GUST\.{0,3}\s*([0-9]{2,3})\s*(MPH|KT|KNOTS)?/i,
    /WIND GUSTS?\.{0,3}\s*([0-9]{2,3})\s*(MPH|KT|KNOTS)?/i,
    /([0-9]{2,3})\s*(MPH|KT|KNOTS)\s+WIND/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const mph = parseWindMph(match[1], match[2] ?? "MPH");
    if (mph) return mph;
  }
  return null;
}

function tornadoFromAlert(props: Record<string, unknown>): string | null {
  const text = `${props.event ?? ""}\n${props.headline ?? ""}\n${props.description ?? ""}`;
  if (!/tornado/i.test(text)) return null;
  return parseEfRating(text);
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
    const { sizeIn, sizeRaw } = hailFromAlert(props);
    const windMph = windFromAlert(props);
    const efRating = tornadoFromAlert(props);
    if (sizeIn == null && windMph == null && efRating == null) continue;
    const ring = outerRing(record?.geometry);
    if (!ring || ringSpanKm(ring) > 300) continue;
    const center = centroid(ring);
    if (!center) continue;
    const when = new Date(String(props.onset ?? props.effective ?? props.sent ?? ""));
    if (Number.isNaN(when.getTime())) continue;
    const id = String(props.id ?? record?.id ?? stableId(["nws", when.toISOString(), center.lat, center.lon]));
    const place = {
      location: clip(props.areaDesc == null ? null : String(props.areaDesc), 200),
      county: null,
      state: null,
      occurredAt: when.toISOString(),
    };
    const headline = props.headline == null ? "" : String(props.headline);
    if (sizeIn != null) {
      reports.push({
        source: "nws",
        externalId: id,
        confidence: "nws",
        hazard: "hail",
        lat: center.lat,
        lon: center.lon,
        sizeIn,
        sizeRaw,
        ...place,
        remark: clip(`NWS warning centroid. ${headline}`.trim(), 2000),
      });
    }
    if (windMph != null) {
      reports.push({
        source: "nws",
        externalId: `${id}:wind`,
        confidence: "nws",
        hazard: "wind",
        lat: center.lat,
        lon: center.lon,
        sizeIn: null,
        sizeRaw: String(windMph),
        windMph,
        ...place,
        remark: clip(`NWS warning centroid. Wind ${windMph} mph. ${headline}`.trim(), 2000),
      });
    }
    if (efRating != null) {
      reports.push({
        source: "nws",
        externalId: `${id}:tornado`,
        confidence: "nws",
        hazard: "tornado",
        lat: center.lat,
        lon: center.lon,
        sizeIn: null,
        sizeRaw: efRating,
        efRating,
        ...place,
        remark: clip(`NWS warning centroid. ${efRating} tornado. ${headline}`.trim(), 2000),
      });
    }
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
      hazard: "hail",
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
