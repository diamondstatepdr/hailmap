import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "@/lib/db";
import type { Confidence } from "@/lib/confidence";
import type { Hazard } from "@/lib/hazard";

export interface HistoryRow {
  id: string;
  source: string;
  confidence: Confidence;
  hazard: Hazard;
  lat: number;
  lon: number;
  sizeIn: number | null;
  windMph: number | null;
  efRating: string | null;
  efRank: number;
  occurredAt: string;
  stormDate: string;
  state: string | null;
  location: string | null;
  county: string | null;
}

export interface HistoryBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

const globalForHistory = globalThis as unknown as { hailHistory?: Database.Database };

export function historyDir(): string {
  return path.join(dataDir(), "history");
}

function databasePath(): string {
  return path.join(historyDir(), "history.sqlite");
}

export function historyDb(): Database.Database {
  if (globalForHistory.hailHistory) return globalForHistory.hailHistory;
  fs.mkdirSync(historyDir(), { recursive: true });
  const db = new Database(databasePath());
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS history_reports (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      hazard TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      size_in REAL,
      wind_mph REAL,
      ef_rating TEXT,
      ef_rank INTEGER NOT NULL DEFAULT -1,
      occurred_at TEXT NOT NULL,
      storm_date TEXT NOT NULL,
      state TEXT,
      location TEXT,
      county TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_hist_day ON history_reports(storm_date, lat, lon);
    CREATE TABLE IF NOT EXISTS history_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS history_days (
      storm_date TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      report_count INTEGER NOT NULL,
      immutable INTEGER NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mesh_days (
      storm_date TEXT PRIMARY KEY,
      cell_count INTEGER NOT NULL,
      max_in REAL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mesh_cells (
      storm_date TEXT NOT NULL,
      lat_q INTEGER NOT NULL,
      lon_q INTEGER NOT NULL,
      max_in REAL NOT NULL,
      PRIMARY KEY (storm_date, lat_q, lon_q)
    );
  `);
  globalForHistory.hailHistory = db;
  return db;
}

export function historyMeta(key: string): string | null {
  const row = historyDb().prepare("SELECT value FROM history_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setHistoryMeta(key: string, value: string) {
  historyDb()
    .prepare("INSERT INTO history_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

const INSERT_REPORT = `
  INSERT OR REPLACE INTO history_reports (
    id, source, confidence, hazard, lat, lon, size_in, wind_mph, ef_rating, ef_rank,
    occurred_at, storm_date, state, location, county
  ) VALUES (
    @id, @source, @confidence, @hazard, @lat, @lon, @sizeIn, @windMph, @efRating, @efRank,
    @occurredAt, @stormDate, @state, @location, @county
  )
`;

export function beginSourceReplace(source: string, hazard?: Hazard) {
  if (hazard) {
    historyDb().prepare("DELETE FROM history_reports WHERE source = ? AND hazard = ?").run(source, hazard);
    return;
  }
  historyDb().prepare("DELETE FROM history_reports WHERE source = ?").run(source);
}

export function insertHistoryRows(rows: HistoryRow[]) {
  if (!rows.length) return;
  const db = historyDb();
  const ins = db.prepare(INSERT_REPORT);
  const tx = db.transaction((batch: HistoryRow[]) => {
    for (const row of batch) ins.run(row);
  });
  tx(rows);
}

export function replaceDayRows(stormDate: string, source: string, rows: HistoryRow[], immutable: boolean) {
  const db = historyDb();
  const del = db.prepare("DELETE FROM history_reports WHERE storm_date = ? AND source = ?");
  const ins = db.prepare(INSERT_REPORT);
  const mark = db.prepare(`
    INSERT INTO history_days (storm_date, source, report_count, immutable, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(storm_date) DO UPDATE SET
      source = excluded.source,
      report_count = excluded.report_count,
      immutable = excluded.immutable,
      fetched_at = excluded.fetched_at
  `);
  const tx = db.transaction(() => {
    del.run(stormDate, source);
    for (const row of rows) ins.run(row);
    mark.run(stormDate, source, rows.length, immutable ? 1 : 0, new Date().toISOString());
  });
  tx();
}

export function dayIsCached(stormDate: string, immutableOnly = false): boolean {
  const row = historyDb()
    .prepare("SELECT immutable FROM history_days WHERE storm_date = ?")
    .get(stormDate) as { immutable: number } | undefined;
  if (!row) return false;
  if (immutableOnly && !row.immutable) return false;
  return true;
}

interface ReportSql {
  id: string;
  source: string;
  confidence: string;
  hazard: string;
  lat: number;
  lon: number;
  size_in: number | null;
  wind_mph: number | null;
  ef_rating: string | null;
  ef_rank: number;
  occurred_at: string;
  storm_date: string;
  state: string | null;
  location: string | null;
  county: string | null;
}

function mapSql(row: ReportSql): HistoryRow {
  return {
    id: row.id,
    source: row.source,
    confidence: row.confidence === "spotter" ? "spotter" : "nws",
    hazard: row.hazard === "wind" || row.hazard === "tornado" ? row.hazard : "hail",
    lat: row.lat,
    lon: row.lon,
    sizeIn: row.size_in,
    windMph: row.wind_mph,
    efRating: row.ef_rating,
    efRank: row.ef_rank,
    occurredAt: row.occurred_at,
    stormDate: row.storm_date,
    state: row.state,
    location: row.location,
    county: row.county,
  };
}

export function countHistory(span: { start: string; end: string }, bounds: HistoryBounds, state: string): number {
  const row = historyDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM history_reports
       WHERE storm_date >= ? AND storm_date <= ?
         AND lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?
         AND (? = '' OR state = ?)`,
    )
    .get(span.start, span.end, bounds.south, bounds.north, bounds.west, bounds.east, state, state) as { n: number };
  return row.n;
}

export function selectHistory(
  span: { start: string; end: string },
  bounds: HistoryBounds,
  state: string,
  limit: number,
): HistoryRow[] {
  const rows = historyDb()
    .prepare(
      `SELECT * FROM history_reports
       WHERE storm_date >= ? AND storm_date <= ?
         AND lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?
         AND (? = '' OR state = ?)
       ORDER BY storm_date, size_in DESC
       LIMIT ?`,
    )
    .all(span.start, span.end, bounds.south, bounds.north, bounds.west, bounds.east, state, state, limit) as ReportSql[];
  return rows.map(mapSql);
}

export function selectHistoryNear(
  span: { start: string; end: string },
  bounds: HistoryBounds,
): HistoryRow[] {
  const rows = historyDb()
    .prepare(
      `SELECT * FROM history_reports
       WHERE storm_date >= ? AND storm_date <= ?
         AND lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?`,
    )
    .all(span.start, span.end, bounds.south, bounds.north, bounds.west, bounds.east) as ReportSql[];
  return rows.map(mapSql);
}

export interface HailDayRow {
  date: string;
  maxHailIn: number | null;
  hailCount: number;
  maxWindMph: number | null;
  windCount: number;
  tornadoCount: number;
  maxEfRank: number;
}

export function hailDaysInBounds(span: { start: string; end: string }, bounds: HistoryBounds, state: string): HailDayRow[] {
  const rows = historyDb()
    .prepare(
      `SELECT storm_date AS date,
              MAX(CASE WHEN hazard = 'hail' THEN size_in END) AS max_hail,
              SUM(CASE WHEN hazard = 'hail' THEN 1 ELSE 0 END) AS hail_n,
              MAX(wind_mph) AS max_wind,
              SUM(CASE WHEN hazard = 'wind' THEN 1 ELSE 0 END) AS wind_n,
              SUM(CASE WHEN hazard = 'tornado' THEN 1 ELSE 0 END) AS torn_n,
              MAX(ef_rank) AS max_ef
       FROM history_reports
       WHERE storm_date >= ? AND storm_date <= ?
         AND lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?
         AND (? = '' OR state = ?)
       GROUP BY storm_date
       HAVING hail_n > 0`,
    )
    .all(span.start, span.end, bounds.south, bounds.north, bounds.west, bounds.east, state, state) as Array<{
      date: string;
      max_hail: number | null;
      hail_n: number;
      max_wind: number | null;
      wind_n: number;
      torn_n: number;
      max_ef: number | null;
    }>;
  return rows.map((row) => ({
    date: row.date,
    maxHailIn: row.max_hail,
    hailCount: row.hail_n,
    maxWindMph: row.max_wind,
    windCount: row.wind_n,
    tornadoCount: row.torn_n,
    maxEfRank: row.max_ef ?? -1,
  }));
}

export function recordMeshGrid(stormDate: string, cells: Array<{ lat: number; lon: number; inches: number }>) {
  const db = historyDb();
  const del = db.prepare("DELETE FROM mesh_cells WHERE storm_date = ?");
  const ins = db.prepare(
    "INSERT INTO mesh_cells (storm_date, lat_q, lon_q, max_in) VALUES (?, ?, ?, ?) ON CONFLICT(storm_date, lat_q, lon_q) DO UPDATE SET max_in = MAX(max_in, excluded.max_in)",
  );
  const mark = db.prepare(`
    INSERT INTO mesh_days (storm_date, cell_count, max_in, fetched_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(storm_date) DO UPDATE SET
      cell_count = excluded.cell_count,
      max_in = excluded.max_in,
      fetched_at = excluded.fetched_at
  `);
  const bins = new Map<string, { latQ: number; lonQ: number; inches: number }>();
  for (const cell of cells) {
    if (cell.inches < 0.5) continue;
    const latQ = Math.round(cell.lat * 10);
    const lonQ = Math.round(cell.lon * 10);
    const key = `${latQ}:${lonQ}`;
    const prev = bins.get(key);
    if (!prev || cell.inches > prev.inches) bins.set(key, { latQ, lonQ, inches: cell.inches });
  }
  let maxIn: number | null = null;
  const tx = db.transaction(() => {
    del.run(stormDate);
    for (const bin of bins.values()) {
      ins.run(stormDate, bin.latQ, bin.lonQ, Math.round(bin.inches * 100) / 100);
      maxIn = maxIn == null ? bin.inches : Math.max(maxIn, bin.inches);
    }
    mark.run(stormDate, bins.size, maxIn, new Date().toISOString());
  });
  tx();
}

export function meshDayReady(stormDate: string): boolean {
  const row = historyDb().prepare("SELECT 1 AS ok FROM mesh_days WHERE storm_date = ?").get(stormDate);
  return Boolean(row);
}

/** Max MESH inches near a point from the coarse 0.1° index, or null when that day was indexed and the point is quiet. */
export function meshAtPoint(stormDate: string, lat: number, lon: number): number | null {
  const latQ = Math.round(lat * 10);
  const lonQ = Math.round(lon * 10);
  const row = historyDb()
    .prepare(
      `SELECT MAX(max_in) AS max_in FROM mesh_cells
       WHERE storm_date = ? AND lat_q BETWEEN ? AND ? AND lon_q BETWEEN ? AND ?`,
    )
    .get(stormDate, latQ - 1, latQ + 1, lonQ - 1, lonQ + 1) as { max_in: number | null };
  return row.max_in;
}

export function meshMaxInBounds(span: { start: string; end: string }, bounds: HistoryBounds): Map<string, number> {
  const south = Math.round(bounds.south * 10) - 1;
  const north = Math.round(bounds.north * 10) + 1;
  const west = Math.round(bounds.west * 10) - 1;
  const east = Math.round(bounds.east * 10) + 1;
  const rows = historyDb()
    .prepare(
      `SELECT storm_date AS date, MAX(max_in) AS max_in FROM mesh_cells
       WHERE storm_date >= ? AND storm_date <= ?
         AND lat_q BETWEEN ? AND ? AND lon_q BETWEEN ? AND ?
       GROUP BY storm_date`,
    )
    .all(span.start, span.end, south, north, west, east) as Array<{ date: string; max_in: number }>;
  return new Map(rows.map((row) => [row.date, row.max_in]));
}

export function indexSummary(): {
  ready: boolean;
  year: number | null;
  hailMin: string | null;
  hailMax: string | null;
  windMin: string | null;
  windMax: string | null;
  tornadoMin: string | null;
  tornadoMax: string | null;
  reports: number;
  meshDays: number;
} {
  const db = historyDb();
  const year = historyMeta("svrgisYear");
  const bounds = db
    .prepare(
      `SELECT hazard,
              MIN(storm_date) AS min_date,
              MAX(storm_date) AS max_date,
              COUNT(*) AS n
       FROM history_reports
       GROUP BY hazard`,
    )
    .all() as Array<{ hazard: string; min_date: string; max_date: string; n: number }>;
  const mesh = db.prepare("SELECT COUNT(*) AS n FROM mesh_days").get() as { n: number };
  const byHazard = new Map(bounds.map((row) => [row.hazard, row]));
  const reports = bounds.reduce((sum, row) => sum + row.n, 0);
  return {
    ready: Boolean(year),
    year: year ? Number(year) : null,
    hailMin: byHazard.get("hail")?.min_date ?? null,
    hailMax: byHazard.get("hail")?.max_date ?? null,
    windMin: byHazard.get("wind")?.min_date ?? null,
    windMax: byHazard.get("wind")?.max_date ?? null,
    tornadoMin: byHazard.get("tornado")?.min_date ?? null,
    tornadoMax: byHazard.get("tornado")?.max_date ?? null,
    reports,
    meshDays: mesh.n,
  };
}

export function directoryBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directoryBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}
