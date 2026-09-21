import { confidenceForImport, type Confidence } from "@/lib/confidence";
import { parseCsv } from "@/lib/csv";
import { upsertReports } from "@/lib/db";
import { validLatLon } from "@/lib/geo";
import { stableId } from "@/lib/ids";
import { parseHailSizeInches } from "@/lib/size";
import type { IncomingReport } from "@/lib/types";

const MAX_ROWS = 5000;

export function assertWebhookAuth(request: Request): Response | null {
  const secret = process.env.HAILMAP_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "HAILMAP_WEBHOOK_SECRET is not configured" }, { status: 503 });
    }
    return null;
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : (request.headers.get("x-hailmap-secret") ?? "");
  if (token !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function clip(value: unknown, max: number): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function manualReport(
  body: unknown,
  confidence: Confidence,
  source: string,
): { ok: true; report: IncomingReport } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object" };
  const record = body as Record<string, unknown>;
  const lat = Number(record.lat ?? record.latitude);
  const lon = Number(record.lon ?? record.lng ?? record.longitude);
  if (!validLatLon(lat, lon)) return { ok: false, error: "lat and lon are required" };

  const sizeField = record.size ?? record.sizeIn ?? record.magnitude;
  const sizeRaw = sizeField == null || sizeField === "" ? null : String(sizeField);
  const sizeIn = sizeRaw == null ? null : parseHailSizeInches(sizeRaw);
  if (sizeRaw != null && sizeIn == null) return { ok: false, error: "Unrecognized hail size" };

  const provided = record.occurredAt ?? record.time ?? record.valid;
  const when = new Date(provided == null || String(provided).trim() === "" ? Date.now() : String(provided));
  if (Number.isNaN(when.getTime())) return { ok: false, error: "Invalid time" };

  const remark = clip(record.remark ?? record.comments ?? record.description, 2000);
  const forced = source === "import" ? confidenceForImport(record.confidence) : confidence;
  const explicitId = clip(record.id ?? record.externalId, 120);
  const externalId =
    explicitId ??
    stableId([source, lat.toFixed(4), lon.toFixed(4), when.toISOString(), sizeIn, clip(record.location ?? record.city, 80)]);

  return {
    ok: true,
    report: {
      source,
      externalId,
      confidence: forced,
      lat,
      lon,
      sizeIn,
      sizeRaw,
      occurredAt: when.toISOString(),
      location: clip(record.location ?? record.city, 200),
      county: clip(record.county, 120),
      state: clip(record.state, 32),
      remark,
    },
  };
}

export function saveManualReport(
  body: unknown,
  confidence: Confidence,
  source: string,
): { ok: true; externalId: string } | { ok: false; error: string } {
  const parsed = manualReport(body, confidence, source);
  if (!parsed.ok) return parsed;
  upsertReports([parsed.report]);
  return { ok: true, externalId: parsed.report.externalId };
}

function indexHeaders(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((header, index) => {
    map[header.trim().toLowerCase()] = index;
  });
  return map;
}

function cell(row: string[], idx: Record<string, number>, names: string[]): string {
  for (const name of names) {
    const index = idx[name];
    if (index != null && row[index] != null) return row[index].trim();
  }
  return "";
}

export function parseCsvImport(text: string): IncomingReport[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const first = rows[0].map((value) => value.trim().toLowerCase());
  const hasHeader = first.some((value) => ["lat", "latitude", "lon", "lng", "longitude"].includes(value));
  const idx = hasHeader
    ? indexHeaders(rows[0])
    : { lat: 0, lon: 1, size: 2, time: 3, location: 4, county: 5, state: 6, remark: 7 };
  const data = hasHeader ? rows.slice(1) : rows;
  const reports: IncomingReport[] = [];
  for (const row of data) {
    if (reports.length >= MAX_ROWS) break;
    const parsed = manualReport(
      {
        lat: cell(row, idx, ["lat", "latitude"]),
        lon: cell(row, idx, ["lon", "lng", "longitude"]),
        size: cell(row, idx, ["size", "sizein", "size_in", "magnitude"]),
        occurredAt: cell(row, idx, ["time", "occurredat", "occurred_at", "valid", "date"]),
        location: cell(row, idx, ["location", "city", "place"]),
        county: cell(row, idx, ["county"]),
        state: cell(row, idx, ["state", "st"]),
        remark: cell(row, idx, ["remark", "comments", "comment", "description"]),
        confidence: cell(row, idx, ["confidence"]),
        id: cell(row, idx, ["id", "externalid", "external_id"]),
      },
      "community",
      "import",
    );
    if (parsed.ok) reports.push(parsed.report);
  }
  return reports;
}

export function parseJsonImport(text: string): IncomingReport[] {
  const json = JSON.parse(text) as unknown;
  if (Array.isArray(json)) {
    return json
      .slice(0, MAX_ROWS)
      .map((item) => manualReport(item, "community", "import"))
      .filter((item): item is { ok: true; report: IncomingReport } => item.ok)
      .map((item) => item.report);
  }
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!record) return [];
  if (Array.isArray(record.reports)) return parseJsonImport(JSON.stringify(record.reports));
  const features =
    record.type === "FeatureCollection" && Array.isArray(record.features)
      ? record.features
      : record.type === "Feature"
        ? [record]
        : [];
  const reports: IncomingReport[] = [];
  for (const feature of features) {
    if (reports.length >= MAX_ROWS) break;
    if (!feature || typeof feature !== "object") continue;
    const item = feature as {
      geometry?: { type?: string; coordinates?: unknown };
      properties?: Record<string, unknown>;
      id?: unknown;
    };
    const props = item.properties ?? {};
    let lat: number | null = null;
    let lon: number | null = null;
    if (item.geometry?.type === "Point" && Array.isArray(item.geometry.coordinates)) {
      lon = Number(item.geometry.coordinates[0]);
      lat = Number(item.geometry.coordinates[1]);
    }
    const parsed = manualReport(
      {
        ...props,
        lat: lat ?? props.lat,
        lon: lon ?? props.lon,
        id: props.id ?? item.id,
      },
      "community",
      "import",
    );
    if (parsed.ok) reports.push(parsed.report);
  }
  return reports;
}

export function parseImportText(text: string, filename: string): IncomingReport[] {
  const trimmed = text.trim();
  const jsonLike =
    filename.toLowerCase().endsWith(".json") ||
    filename.toLowerCase().endsWith(".geojson") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[");
  return jsonLike ? parseJsonImport(trimmed) : parseCsvImport(trimmed);
}

export function saveImportedReports(reports: IncomingReport[]): number {
  return upsertReports(reports);
}
