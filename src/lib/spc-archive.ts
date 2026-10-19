import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { parseCsv } from "@/lib/csv";
import { efRank } from "@/lib/hazard";
import { stableId } from "@/lib/ids";
import { userAgent } from "@/lib/ingest";
import { SPC_DAILY_START, SPC_SVRGIS_PROBED_YEAR } from "@/lib/history-coverage";
import {
  beginSourceReplace,
  dayIsCached,
  historyDir,
  historyMeta,
  insertHistoryRows,
  replaceDayRows,
  setHistoryMeta,
  type HistoryRow,
} from "@/lib/history-db";
import { addIsoDays, isoDateUTC } from "@/lib/mesh-plan";
import { gapFor, hostOf, pace } from "@/lib/paced";
import { parseSpcHailCsv, parseSpcTornadoCsv, parseSpcWindCsv, spcFileStamp } from "@/lib/parsers";
import type { Hazard } from "@/lib/hazard";
import type { IncomingReport } from "@/lib/types";

const execFileAsync = promisify(execFile);

const KNOTS_TO_MPH = 1.15078;

let indexJob: Promise<void> | null = null;
let dailyTail: Promise<void> | null = null;
const dailyWaiters = new Map<string, Promise<void>>();

export function svrgisYearFromMeta(): number | null {
  const year = historyMeta("svrgisYear");
  return year ? Number(year) : null;
}

export function svrgisEndDate(): string | null {
  const year = svrgisYearFromMeta();
  return year ? `${year}-12-31` : null;
}

/** SPC severe-database clock times are Central Standard Time all year (UTC−6). */
export function spcCstToIso(date: string, time: string): string | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  let hour: number;
  let minute: number;
  let second = 0;
  if (match) {
    hour = Number(match[1]);
    minute = Number(match[2]);
    second = Number(match[3] ?? 0);
  } else if (/^\d{3,4}$/.test(time.trim())) {
    const hhmm = time.trim().padStart(4, "0");
    hour = Number(hhmm.slice(0, 2));
    minute = Number(hhmm.slice(2, 4));
  } else {
    return null;
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, hour + 6, minute, second)).toISOString();
}

function column(header: string[], name: string): number {
  const index = header.findIndex((cell) => cell.trim().toLowerCase() === name);
  if (index < 0) throw new Error(`SPC file is missing the ${name} column`);
  return index;
}

function inches(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const size = value > 20 ? value / 100 : value;
  if (size < 0.25 || size > 10) return null;
  return Math.round(size * 100) / 100;
}

function windMphFromKnots(raw: string): number | null {
  const knots = Number(raw);
  if (!Number.isFinite(knots) || knots <= 0 || knots > 250) return null;
  return Math.round(knots * KNOTS_TO_MPH);
}

function tornadoRating(year: number, raw: string): { efRating: string | null; efRank: number } {
  const mag = Number(raw);
  if (!Number.isFinite(mag) || mag < 0 || mag > 5) return { efRating: null, efRank: -1 };
  const efRating = `${year >= 2007 ? "EF" : "F"}${mag}`;
  return { efRating, efRank: mag };
}

export function parseSvrgisCsv(csv: string, hazard: Hazard): HistoryRow[] {
  const table = parseCsv(csv.replace(/^\uFEFF/, ""));
  if (!table.length) return [];
  const header = table[0].map((cell) => cell.trim().toLowerCase());
  if (!header.includes("date") || !header.includes("slat")) return [];
  const dateI = column(header, "date");
  const timeI = column(header, "time");
  const stateI = column(header, "st");
  const magI = column(header, "mag");
  const latI = column(header, "slat");
  const lonI = column(header, "slon");
  const omI = header.indexOf("om");
  const rows: HistoryRow[] = [];
  for (const cols of table.slice(1)) {
    const stormDate = cols[dateI]?.trim() ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stormDate)) continue;
    const lat = Number(cols[latI]);
    const lon = Number(cols[lonI]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const occurredAt = spcCstToIso(stormDate, cols[timeI] ?? "") ?? `${stormDate}T18:00:00.000Z`;
    const state = (cols[stateI] ?? "").trim().toUpperCase();
    const mag = cols[magI] ?? "";
    const om = omI >= 0 ? cols[omI] : "";
    let sizeIn: number | null = null;
    let windMph: number | null = null;
    let efRating: string | null = null;
    let rank = -1;
    if (hazard === "hail") {
      sizeIn = inches(mag);
      if (sizeIn == null) continue;
    } else if (hazard === "wind") {
      windMph = windMphFromKnots(mag);
    } else {
      const rating = tornadoRating(Number(stormDate.slice(0, 4)), mag);
      efRating = rating.efRating;
      rank = rating.efRank;
    }
    rows.push({
      id: stableId(["svrgis", hazard, om, stormDate, lat.toFixed(4), lon.toFixed(4), mag]),
      source: "spc-svrgis",
      confidence: "nws",
      hazard,
      lat,
      lon,
      sizeIn,
      windMph,
      efRating,
      efRank: rank,
      occurredAt,
      stormDate,
      state: state.length === 2 ? state : state || null,
      location: null,
      county: null,
    });
  }
  return rows;
}

function dailyRows(reports: IncomingReport[], hazard: Hazard, stormDate: string): HistoryRow[] {
  return reports.map((report) => ({
    id: stableId(["spc-daily", report.externalId]),
    source: "spc-daily",
    confidence: report.confidence === "spotter" ? "spotter" : "nws",
    hazard,
    lat: report.lat,
    lon: report.lon,
    sizeIn: report.sizeIn,
    windMph: report.windMph ?? null,
    efRating: report.efRating ?? null,
    efRank: efRank(report.efRating),
    occurredAt: report.occurredAt,
    stormDate,
    state: report.state,
    location: report.location,
    county: report.county,
  }));
}

async function fetchText(url: string): Promise<{ text: string; lastModified: string | null; status: number }> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await pace(hostOf(url), gapFor(url), async () => {
      const response = await fetch(url, {
        headers: { "User-Agent": userAgent(), Accept: "text/csv,text/plain,application/zip,*/*" },
        signal: AbortSignal.timeout(120000),
      });
      if (response.status === 404 || response.status >= 500 || response.status === 429) {
        return { text: "", lastModified: null as string | null, status: response.status };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return {
        text: await response.text(),
        lastModified: response.headers.get("last-modified"),
        status: response.status,
      };
    });
    if (result.status === 200 || result.status === 404) return result;
    lastStatus = result.status;
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw new Error(`HTTP ${lastStatus} for ${url}`);
}

async function downloadFile(url: string, dest: string): Promise<string | null> {
  return pace(hostOf(url), gapFor(url), async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/zip,application/octet-stream,*/*" },
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const temporary = `${dest}.tmp`;
    fs.writeFileSync(temporary, bytes);
    fs.renameSync(temporary, dest);
    return response.headers.get("last-modified");
  });
}

async function unzipCsv(zipPath: string, dest: string): Promise<void> {
  await execFileAsync(
    "python3",
    [
      "-c",
      `import zipfile, sys
zf = zipfile.ZipFile(sys.argv[1])
names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
if not names:
    raise SystemExit("no csv in zip")
with zf.open(names[0]) as src, open(sys.argv[2], "wb") as dst:
    while True:
        chunk = src.read(1 << 20)
        if not chunk:
            break
        dst.write(chunk)
`,
      zipPath,
      dest,
    ],
    { timeout: 180000 },
  );
}

export async function discoverSvrgisYear(now = new Date()): Promise<number> {
  const year = now.getUTCFullYear();
  for (const candidate of [year, year - 1, year - 2, SPC_SVRGIS_PROBED_YEAR]) {
    const url = `https://www.spc.noaa.gov/wcm/data/1955-${candidate}_hail.csv.zip`;
    const head = await pace(hostOf(url), gapFor(url), () =>
      fetch(url, { method: "HEAD", headers: { "User-Agent": userAgent() }, signal: AbortSignal.timeout(20000) }),
    );
    if (head.ok) return candidate;
  }
  throw new Error("SPC severe-weather database was not found");
}

async function ingestSvrgis(year: number) {
  const dir = path.join(historyDir(), "spc");
  fs.mkdirSync(dir, { recursive: true });
  const files = [
    {
      hazard: "hail" as const,
      url: `https://www.spc.noaa.gov/wcm/data/1955-${year}_hail.csv.zip`,
      zip: path.join(dir, `1955-${year}_hail.csv.zip`),
    },
    {
      hazard: "wind" as const,
      url: `https://www.spc.noaa.gov/wcm/data/1955-${year}_wind.csv.zip`,
      zip: path.join(dir, `1955-${year}_wind.csv.zip`),
    },
  ];
  const tornadoUrl = `https://www.spc.noaa.gov/wcm/data/1950-${year}_actual_tornadoes.csv`;
  const tornadoPath = path.join(dir, `1950-${year}_actual_tornadoes.csv`);

  for (const file of files) {
    const modified = await downloadFile(file.url, file.zip);
    const csvPath = file.zip.replace(/\.zip$/, ".extracted.csv");
    await unzipCsv(file.zip, csvPath);
    const rows = parseSvrgisCsv(fs.readFileSync(csvPath, "utf8"), file.hazard);
    beginSourceReplace("spc-svrgis", file.hazard);
    for (let offset = 0; offset < rows.length; offset += 4000) {
      insertHistoryRows(rows.slice(offset, offset + 4000));
    }
    setHistoryMeta(`spc-svrgis-${file.hazard}-modified`, modified ?? "");
    setHistoryMeta(`spc-svrgis-${file.hazard}-count`, String(rows.length));
    fs.rmSync(csvPath, { force: true });
  }

  const modified = await downloadFile(tornadoUrl, tornadoPath);
  const tornadoRows = parseSvrgisCsv(fs.readFileSync(tornadoPath, "utf8"), "tornado");
  beginSourceReplace("spc-svrgis", "tornado");
  for (let offset = 0; offset < tornadoRows.length; offset += 4000) {
    insertHistoryRows(tornadoRows.slice(offset, offset + 4000));
  }
  setHistoryMeta("spc-svrgis-tornado-modified", modified ?? "");
  setHistoryMeta("spc-svrgis-tornado-count", String(tornadoRows.length));
  setHistoryMeta("svrgisYear", String(year));
  setHistoryMeta("svrgisBuiltAt", new Date().toISOString());
}

export function ensureHistoryIndex(): Promise<void> {
  if (svrgisYearFromMeta()) return Promise.resolve();
  if (!indexJob) {
    indexJob = (async () => {
      const year = await discoverSvrgisYear();
      await ingestSvrgis(year);
    })().finally(() => {
      indexJob = null;
    });
  }
  return indexJob;
}

function closedDay(stormDate: string, now = new Date()): boolean {
  const end = Date.parse(`${addIsoDays(stormDate, 1)}T18:00:00Z`);
  return Number.isFinite(end) && now.getTime() > end;
}

export async function ensureDaily(stormDate: string, now = new Date()): Promise<void> {
  if (stormDate < SPC_DAILY_START || stormDate > isoDateUTC(now)) return;
  const end = svrgisEndDate();
  if (end && stormDate <= end) return;
  const immutable = closedDay(stormDate, now);
  if (dayIsCached(stormDate, immutable)) return;
  const pending = dailyWaiters.get(stormDate);
  if (pending) return pending;
  const job = (async () => {
    const stamp = spcFileStamp(stormDate);
    const base = `https://www.spc.noaa.gov/climo/reports/${stamp}_rpts`;
    const [hail, wind, tornado] = await Promise.all([
      fetchText(`${base}_hail.csv`),
      fetchText(`${base}_wind.csv`),
      fetchText(`${base}_torn.csv`),
    ]);
    const rows = [
      hail.status === 200 ? dailyRows(parseSpcHailCsv(hail.text, stormDate), "hail", stormDate) : [],
      wind.status === 200 ? dailyRows(parseSpcWindCsv(wind.text, stormDate), "wind", stormDate) : [],
      tornado.status === 200 ? dailyRows(parseSpcTornadoCsv(tornado.text, stormDate), "tornado", stormDate) : [],
    ].flat();
    if (hail.status === 404 && wind.status === 404 && tornado.status === 404) {
      replaceDayRows(stormDate, "spc-daily", [], immutable);
      return;
    }
    replaceDayRows(stormDate, "spc-daily", rows, immutable);
    const cacheDir = path.join(historyDir(), "spc-daily");
    fs.mkdirSync(cacheDir, { recursive: true });
    if (hail.status === 200) fs.writeFileSync(path.join(cacheDir, `${stormDate}-hail.csv`), hail.text);
    if (wind.status === 200) fs.writeFileSync(path.join(cacheDir, `${stormDate}-wind.csv`), wind.text);
    if (tornado.status === 200) fs.writeFileSync(path.join(cacheDir, `${stormDate}-torn.csv`), tornado.text);
  })().finally(() => {
    dailyWaiters.delete(stormDate);
  });
  dailyWaiters.set(stormDate, job);
  return job;
}

export function listDates(start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && dates.length < 8000) {
    dates.push(cursor);
    cursor = addIsoDays(cursor, 1);
  }
  return dates;
}

/** Fetch SPC daily files for the gap after the annual database. Awaits a bounded prefix and continues in the background. */
export async function ensureDailySpan(start: string, end: string, awaitDays = 16): Promise<{ pending: number }> {
  await ensureHistoryIndex();
  const archiveEnd = svrgisEndDate();
  const today = isoDateUTC(new Date());
  const from = archiveEnd && start <= archiveEnd ? addIsoDays(archiveEnd, 1) : start;
  if (from > end || from > today) return { pending: 0 };
  const dates = listDates(from, end > today ? today : end).filter((date) => !dayIsCached(date, closedDay(date)));
  const immediate = dates.slice(0, awaitDays);
  await Promise.all(immediate.map((date) => ensureDaily(date).catch((error) => {
    console.error("[hailmap] daily", date, error instanceof Error ? error.message : error);
  })));
  const rest = dates.slice(awaitDays);
  if (rest.length && !dailyTail) {
    dailyTail = (async () => {
      for (const date of rest) {
        try {
          await ensureDaily(date);
        } catch (error) {
          console.error("[hailmap] daily", date, error instanceof Error ? error.message : error);
        }
      }
    })().finally(() => {
      dailyTail = null;
    });
  }
  return { pending: rest.length };
}

export function startDailyTail() {
  const end = svrgisEndDate();
  if (!end) return;
  const yesterday = addIsoDays(isoDateUTC(new Date()), -1);
  if (yesterday <= end) return;
  void ensureDailySpan(addIsoDays(end, 1), yesterday, 8).catch((error) => {
    console.error("[hailmap] history tail", error instanceof Error ? error.message : error);
  });
}
