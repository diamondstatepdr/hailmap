import fs from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/db";
import { haversineKm } from "@/lib/geo";
import { gunzipIfNeeded, sampleGribBin } from "@/lib/grib-mesh";
import { userAgent } from "@/lib/ingest";
import { addUtcDays, parseIemGeoJson, parseSpcHailCsv, spcFileStamp } from "@/lib/parsers";
import {
  decideConfirmation,
  parseProofConfirm,
  timeZoneAt,
  unavailableConfirm,
  type LsrHit,
  type ProofConfirm,
} from "@/lib/proof-confirm";
import type { IncomingReport } from "@/lib/types";

const SAMPLE_GAP_MS = 30 * 60 * 1000;
const FINE_STEP_MS = 2 * 60 * 1000;

interface RadarSample {
  at: string;
  inches: number;
  ms: number;
}

function gribStamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}00`;
}

function mesh60Url(ms: number): string {
  return `https://mrms.ncep.noaa.gov/2D/MESH_Max_60min/MRMS_MESH_Max_60min_00.50_${gribStamp(ms)}.grib2.gz`;
}

function cellCachePath(ms: number, lat: number, lon: number): string {
  return path.join(dataDir(), "proof-radar", "cells", `${gribStamp(ms)}-${lat.toFixed(3)}-${lon.toFixed(3)}.json`);
}

function confirmCachePath(stormDate: string, lat: number, lon: number): string {
  return path.join(dataDir(), "proof-radar", `${stormDate}-${lat.toFixed(3)}-${lon.toFixed(3)}.json`);
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function sampleScan(ms: number, lat: number, lon: number): Promise<RadarSample | null> {
  const cached = cellCachePath(ms, lat, lon);
  try {
    if (fs.existsSync(cached)) {
      const stored = JSON.parse(fs.readFileSync(cached, "utf8")) as { at?: string; inches?: number };
      const at = typeof stored.at === "string" ? stored.at : "";
      const inches = Number(stored.inches);
      const when = Date.parse(at);
      if (Number.isFinite(when) && Number.isFinite(inches)) return { at: new Date(when).toISOString(), inches, ms: when };
    }
  } catch {
    /* fetch again */
  }
  try {
    const response = await fetch(mesh60Url(ms), {
      headers: { "User-Agent": userAgent(), Accept: "application/octet-stream,*/*" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const decoded = sampleGribBin(gunzipIfNeeded(Buffer.from(await response.arrayBuffer())), lat, lon);
    const when = Date.parse(decoded.validTime);
    if (!Number.isFinite(when)) return null;
    const sample = { at: new Date(when).toISOString(), inches: decoded.inches, ms: when };
    try {
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      fs.writeFileSync(cached, JSON.stringify(sample));
    } catch {
      /* the scan still counts */
    }
    return sample;
  } catch {
    return null;
  }
}

function earliestPeak(samples: RadarSample[]): RadarSample | null {
  if (!samples.length) return null;
  const peak = Math.max(...samples.map((sample) => sample.inches));
  if (peak <= 0) return null;
  return samples
    .filter((sample) => sample.inches >= peak - 0.05)
    .sort((a, b) => a.ms - b.ms)[0] ?? null;
}

/** Valid time of the 2-minute MESH hour-maximum when hail at this point first reaches its peak. */
export async function findRadarScan(lat: number, lon: number, stormDate: string): Promise<{
  radarKind: "scan" | "unavailable";
  radarIn: number | null;
  radarAt: string | null;
}> {
  const start = Date.parse(`${stormDate}T12:00:00.000Z`);
  const end = Date.parse(`${addUtcDays(stormDate, 1)}T12:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { radarKind: "unavailable", radarIn: null, radarAt: null };

  const probes = [0, 6, 12, 18, 23].map((hours) => start + hours * 3600000);
  const probeHits = (await mapPool(probes, 5, (ms) => sampleScan(ms, lat, lon))).filter((sample): sample is RadarSample => sample != null);
  if (!probeHits.length) return { radarKind: "unavailable", radarIn: null, radarAt: null };

  const coarseTimes: number[] = [];
  for (let time = start; time <= end; time += SAMPLE_GAP_MS) coarseTimes.push(time);
  const coarse = (await mapPool(coarseTimes, 4, (ms) => sampleScan(ms, lat, lon))).filter((sample): sample is RadarSample => sample != null);
  const coarsePeak = earliestPeak(coarse.length ? coarse : probeHits);
  if (!coarsePeak) return { radarKind: "scan", radarIn: 0, radarAt: null };

  const fineTimes: number[] = [];
  for (let time = coarsePeak.ms - 36 * 60 * 1000; time <= coarsePeak.ms; time += FINE_STEP_MS) {
    if (time >= start && time <= end) fineTimes.push(time);
  }
  const fine = (await mapPool(fineTimes, 4, (ms) => sampleScan(ms, lat, lon))).filter((sample): sample is RadarSample => sample != null);
  const peak = earliestPeak([...coarse, ...fine, ...probeHits]);
  if (!peak) return { radarKind: "scan", radarIn: 0, radarAt: null };
  return { radarKind: "scan", radarIn: peak.inches, radarAt: peak.at };
}

function whereOf(report: IncomingReport): string {
  return [report.location, report.county, report.state].filter(Boolean).join(", ");
}

function sameHit(left: LsrHit, right: IncomingReport): boolean {
  const when = Date.parse(right.occurredAt);
  const leftWhen = Date.parse(left.occurredAt);
  if (!Number.isFinite(when) || Math.abs(when - leftWhen) > 15 * 60 * 1000) return false;
  if (haversineKm(left.lat, left.lon, right.lat, right.lon) > 2) return false;
  return Math.abs(left.sizeIn - (right.sizeIn ?? -1)) < 0.2;
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "text/csv,text/plain,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return response.text();
  } catch {
    return null;
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/geo+json, application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function observerFromIem(payload: unknown, report: IncomingReport): string | null {
  const features = payload && typeof payload === "object" ? (payload as { features?: unknown }).features : null;
  if (!Array.isArray(features)) return null;
  const when = Date.parse(report.occurredAt);
  let best: string | null = null;
  let bestDt = Infinity;
  let bestSize = Infinity;
  for (const feature of features) {
    const record = feature && typeof feature === "object" ? (feature as { properties?: Record<string, unknown> }) : null;
    const props = record?.properties;
    if (!props) continue;
    const lat = Number(props.lat);
    const lon = Number(props.lon);
    const occurred = Date.parse(String(props.valid ?? ""));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(occurred)) continue;
    const dt = Math.abs(occurred - when);
    if (dt > 15 * 60 * 1000) continue;
    if (haversineKm(report.lat, report.lon, lat, lon) > 2) continue;
    const magnitude = Number(props.magf ?? props.magnitude);
    const sizeDelta = Number.isFinite(magnitude) ? Math.abs(magnitude - (report.sizeIn ?? magnitude)) : 0;
    const closer = dt + 60 * 1000 < bestDt || (Math.abs(dt - bestDt) <= 60 * 1000 && sizeDelta < bestSize);
    if (!closer) continue;
    const source = props.source == null ? "" : String(props.source).trim();
    best = source || null;
    bestDt = dt;
    bestSize = sizeDelta;
  }
  return best;
}

export async function loadSpotterReports(stormDate: string): Promise<LsrHit[]> {
  const stamp = spcFileStamp(stormDate);
  const start = `${stormDate.replace(/-/g, "")}1200`;
  const end = `${addUtcDays(stormDate, 1).replace(/-/g, "")}1200`;
  const [csv, iem] = await Promise.all([
    fetchText(`https://www.spc.noaa.gov/climo/reports/${stamp}_rpts_hail.csv`, 15000),
    fetchJson(`https://mesonet.agron.iastate.edu/geojson/lsr.py?sts=${start}&ets=${end}`, 20000),
  ]);
  const spc = csv ? parseSpcHailCsv(csv, stormDate) : [];
  const iemReports = iem ? parseIemGeoJson(iem).filter((report) => report.hazard === "hail" && report.sizeIn != null) : [];
  const hits: LsrHit[] = spc
    .filter((report) => report.sizeIn != null)
    .map((report) => ({
      occurredAt: report.occurredAt,
      lat: report.lat,
      lon: report.lon,
      sizeIn: report.sizeIn ?? 0,
      where: whereOf(report),
      remark: report.remark,
      observer: iem ? observerFromIem(iem, report) : null,
      from: "spc" as const,
    }));
  for (const report of iemReports) {
    if (hits.some((hit) => sameHit(hit, report))) continue;
    hits.push({
      occurredAt: report.occurredAt,
      lat: report.lat,
      lon: report.lon,
      sizeIn: report.sizeIn ?? 0,
      where: whereOf(report),
      remark: report.remark,
      observer: observerFromIem(iem, report),
      from: "iem",
    });
  }
  return hits;
}

function readConfirmCache(file: string): ProofConfirm | null {
  try {
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    const age = Date.now() - stat.mtimeMs;
    const parsed = parseProofConfirm(JSON.parse(fs.readFileSync(file, "utf8")));
    if (!parsed) return null;
    const ttl = parsed.radarKind === "scan" ? 12 * 3600000 : 15 * 60 * 1000;
    if (age > ttl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadProofConfirm(input: { lat: number; lon: number; stormDate: string }): Promise<ProofConfirm> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.stormDate)) return unavailableConfirm();
  const cacheFile = confirmCachePath(input.stormDate, input.lat, input.lon);
  const cached = readConfirmCache(cacheFile);
  if (cached) return cached;

  const timeZone = timeZoneAt(input.lat, input.lon);
  const [reports, radar] = await Promise.all([
    loadSpotterReports(input.stormDate),
    findRadarScan(input.lat, input.lon, input.stormDate),
  ]);

  let radarKind: ProofConfirm["radarKind"] = radar.radarKind;
  let radarAt = radar.radarAt;
  let radarIn = radar.radarIn;
  if (radar.radarKind === "unavailable") {
    radarKind = "daily";
    radarAt = `${addUtcDays(input.stormDate, 1)}T12:00:00.000Z`;
    radarIn = null;
  }

  const confirm = decideConfirmation({
    lat: input.lat,
    lon: input.lon,
    timeZone,
    radarIn,
    radarAt,
    radarKind,
    reports,
  });
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(confirm));
  } catch {
    /* still return the live result */
  }
  return confirm;
}
