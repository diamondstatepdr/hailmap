import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { asConfidence } from "@/lib/confidence";
import { extractDamageTags } from "@/lib/damage";
import { validLatLon } from "@/lib/geo";
import { hazardOf } from "@/lib/hazard";
import type { HailReport, IncomingReport } from "@/lib/types";

interface ReportRow {
  id: string;
  source: string;
  external_id: string;
  confidence: string;
  lat: number;
  lon: number;
  size_in: number | null;
  size_raw: string | null;
  wind_mph: number | null;
  ef_rating: string | null;
  hazard: string | null;
  occurred_at: string;
  location: string | null;
  county: string | null;
  state: string | null;
  remark: string | null;
  damage_tags: string;
  photo_id: string | null;
}

const globalForDb = globalThis as unknown as { hailDb?: Database.Database };

export function dataDir(): string {
  return process.env.HAILMAP_DATA_DIR || path.join(process.cwd(), ".data");
}

function mapRow(row: ReportRow): HailReport {
  let damageTags: string[] = [];
  try {
    const parsed = JSON.parse(row.damage_tags) as unknown;
    if (Array.isArray(parsed)) damageTags = parsed.map(String);
  } catch {
    damageTags = [];
  }
  return {
    id: row.id,
    source: row.source,
    confidence: asConfidence(row.confidence) ?? "community",
    lat: row.lat,
    lon: row.lon,
    sizeIn: row.size_in,
    sizeRaw: row.size_raw,
    windMph: row.wind_mph,
    efRating: row.ef_rating,
    hazard: hazardOf(row.hazard),
    occurredAt: row.occurred_at,
    location: row.location,
    county: row.county,
    state: row.state,
    remark: row.remark,
    damageTags,
    photoId: row.photo_id,
    photoUrl: row.photo_id ? `/api/photos/${row.photo_id.replace(/\.(jpg|png|webp|heic)$/i, "")}` : null,
  };
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      confidence TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      size_in REAL,
      size_raw TEXT,
      occurred_at TEXT NOT NULL,
      location TEXT,
      county TEXT,
      state TEXT,
      remark TEXT,
      damage_tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reports_time ON reports(occurred_at);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photo_submits (
      ip_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photo_submits_ip ON photo_submits(ip_hash, created_at);
  `);
  const columns = db.prepare("PRAGMA table_info(reports)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "photo_id")) {
    db.exec("ALTER TABLE reports ADD COLUMN photo_id TEXT");
  }
  if (!columns.some((column) => column.name === "hazard")) {
    db.exec("ALTER TABLE reports ADD COLUMN hazard TEXT NOT NULL DEFAULT 'hail'");
  }
  if (!columns.some((column) => column.name === "wind_mph")) {
    db.exec("ALTER TABLE reports ADD COLUMN wind_mph REAL");
  }
  if (!columns.some((column) => column.name === "ef_rating")) {
    db.exec("ALTER TABLE reports ADD COLUMN ef_rating TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watch_places (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      label TEXT NOT NULL,
      query TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      radius_km REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_watch_user ON watch_places(user_id, created_at);
    CREATE TABLE IF NOT EXISTS field_pins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_field_pins_user ON field_pins(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS field_photos (
      id TEXT PRIMARY KEY,
      pin_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      damage_type TEXT NOT NULL,
      note TEXT,
      taken_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_field_photos_pin ON field_photos(pin_id, created_at);
    CREATE TABLE IF NOT EXISTS storm_reports (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_storm_reports_user ON storm_reports(user_id, created_at);
    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action_limits (
      ip_hash TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_action_limits ON action_limits(kind, ip_hash, created_at);
  `);
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function seed(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
  if (count.n > 0) return;
  const samples: IncomingReport[] = [
    {
      source: "seed",
      externalId: "seed-norman",
      confidence: "spotter",
      lat: 35.22,
      lon: -97.44,
      sizeIn: 1.75,
      sizeRaw: "golf ball",
      occurredAt: hoursAgo(2),
      location: "Norman",
      county: "Cleveland",
      state: "OK",
      remark: "Golf ball hail dented cars and broke a windshield.",
    },
    {
      source: "seed",
      externalId: "seed-moore",
      confidence: "nws",
      lat: 35.34,
      lon: -97.49,
      sizeIn: 1.25,
      sizeRaw: "1.25",
      occurredAt: hoursAgo(2.4),
      location: "Moore",
      county: "Cleveland",
      state: "OK",
      remark: "NWS relayed half-dollar hail with roof shingle damage.",
    },
    {
      source: "seed",
      externalId: "seed-dallas",
      confidence: "community",
      lat: 32.78,
      lon: -96.8,
      sizeIn: 1,
      sizeRaw: "quarter",
      occurredAt: hoursAgo(5),
      location: "Dallas",
      county: "Dallas",
      state: "TX",
      remark: "Quarter size hail, minor vehicle dents.",
    },
    {
      source: "seed",
      externalId: "seed-wichita",
      confidence: "nws",
      lat: 37.69,
      lon: -97.34,
      sizeIn: 2,
      sizeRaw: "2.00",
      occurredAt: hoursAgo(8),
      location: "Wichita",
      county: "Sedgwick",
      state: "KS",
      remark: "Hen egg hail broke windows and damaged siding.",
    },
    {
      source: "seed",
      externalId: "seed-denver",
      confidence: "mesh",
      lat: 39.74,
      lon: -104.99,
      sizeIn: 1.5,
      sizeRaw: "1.50",
      occurredAt: hoursAgo(3),
      location: "Denver",
      county: "Denver",
      state: "CO",
      remark: "MESH stub sample near Denver.",
    },
    {
      source: "seed",
      externalId: "seed-okc-wind",
      confidence: "nws",
      hazard: "wind",
      lat: 35.47,
      lon: -97.52,
      sizeIn: null,
      sizeRaw: null,
      windMph: 72,
      occurredAt: hoursAgo(2.1),
      location: "Oklahoma City",
      county: "Oklahoma",
      state: "OK",
      remark: "Sample thunderstorm wind gust. Replaced when a live feed responds.",
    },
    {
      source: "seed",
      externalId: "seed-moore-tornado",
      confidence: "spotter",
      hazard: "tornado",
      lat: 35.33,
      lon: -97.51,
      sizeIn: null,
      sizeRaw: null,
      efRating: "EF1",
      occurredAt: hoursAgo(2.2),
      location: "Moore",
      county: "Cleveland",
      state: "OK",
      remark: "Sample tornado local storm report. Replaced when a live feed responds.",
    },
  ];
  insertAll(db, samples);
}

function insertAll(db: Database.Database, rows: IncomingReport[]): number {
  const stmt = db.prepare(`
    INSERT INTO reports (
      id, source, external_id, confidence, hazard, lat, lon, size_in, size_raw,
      wind_mph, ef_rating, occurred_at, location, county, state, remark, damage_tags, photo_id, created_at, updated_at
    ) VALUES (
      @id, @source, @external_id, @confidence, @hazard, @lat, @lon, @size_in, @size_raw,
      @wind_mph, @ef_rating, @occurred_at, @location, @county, @state, @remark, @damage_tags, @photo_id, @created_at, @updated_at
    )
    ON CONFLICT(source, external_id) DO UPDATE SET
      confidence = excluded.confidence,
      hazard = excluded.hazard,
      lat = excluded.lat,
      lon = excluded.lon,
      size_in = excluded.size_in,
      size_raw = excluded.size_raw,
      wind_mph = excluded.wind_mph,
      ef_rating = excluded.ef_rating,
      occurred_at = excluded.occurred_at,
      location = excluded.location,
      county = excluded.county,
      state = excluded.state,
      remark = excluded.remark,
      damage_tags = excluded.damage_tags,
      photo_id = COALESCE(excluded.photo_id, reports.photo_id),
      updated_at = excluded.updated_at
  `);
  const now = new Date().toISOString();
  const tx = db.transaction((items: IncomingReport[]) => {
    let written = 0;
    for (const item of items) {
      if (!validLatLon(item.lat, item.lon)) continue;
      const occurred = new Date(item.occurredAt);
      if (Number.isNaN(occurred.getTime())) continue;
      stmt.run({
        id: `${item.source}:${item.externalId}`,
        source: item.source,
        external_id: item.externalId,
        confidence: item.confidence,
        hazard: hazardOf(item.hazard),
        lat: item.lat,
        lon: item.lon,
        size_in: item.sizeIn,
        size_raw: item.sizeRaw,
        wind_mph: item.windMph ?? null,
        ef_rating: item.efRating ?? null,
        occurred_at: occurred.toISOString(),
        location: item.location,
        county: item.county,
        state: item.state,
        remark: item.remark,
        damage_tags: JSON.stringify(extractDamageTags(item.remark)),
        photo_id: item.photoId ?? null,
        created_at: now,
        updated_at: now,
      });
      written += 1;
    }
    return written;
  });
  return tx(rows);
}

export function getDb(): Database.Database {
  if (!globalForDb.hailDb) {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, "hailmap.sqlite"));
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    migrate(db);
    seed(db);
    globalForDb.hailDb = db;
  }
  return globalForDb.hailDb;
}

export function upsertReports(rows: IncomingReport[]): number {
  return insertAll(getDb(), rows);
}

export function listRecentReports(days = 7): HailReport[] {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT * FROM reports WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT 8000`,
    )
    .all(since) as ReportRow[];
  return rows.map(mapRow);
}

export function reportCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
  return row.n;
}

export function pruneLiveReports(olderThanIso: string) {
  getDb()
    .prepare(`DELETE FROM reports WHERE source IN ('spc', 'iem', 'nws', 'mesh') AND occurred_at < ?`)
    .run(olderThanIso);
}

export function deleteSeedReports() {
  getDb().prepare(`DELETE FROM reports WHERE source = 'seed'`).run();
}

export function setMeta(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getMeta(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
