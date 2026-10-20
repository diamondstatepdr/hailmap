import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import {
  DEFAULT_PREFS,
  isRadiusMi,
  isThreshold,
  stateName,
  US_STATES,
  type AlertKind,
  type WatchKind,
} from "@/lib/alert-model";

export interface PushDevice {
  id: string;
  deviceKey: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  timeZone: string;
  quietStart: string | null;
  quietEnd: string | null;
  lat: number | null;
  lon: number | null;
  locationAt: string | null;
  lastTestAt: string | null;
  createdAt: string;
}

export interface AlertArea {
  id: string;
  kind: WatchKind;
  label: string;
  lat: number | null;
  lon: number | null;
  radiusMi: number;
  state: string | null;
  minSizeIn: number;
  mesh: boolean;
  reports: boolean;
  warnings: boolean;
  outlook: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  areaId: string;
  stormKey: string;
  kind: AlertKind;
  title: string;
  body: string;
  place: string;
  sizeIn: number | null;
  occurredAt: string;
  lat: number | null;
  lon: number | null;
  url: string;
  status: string;
  createdAt: string;
  sentAt: string | null;
}

export interface AreaInput {
  kind: WatchKind;
  label?: string;
  lat?: number | null;
  lon?: number | null;
  radiusMi?: number;
  state?: string | null;
  minSizeIn?: number;
  mesh?: boolean;
  reports?: boolean;
  warnings?: boolean;
  outlook?: boolean;
}

interface DeviceRow {
  id: string;
  device_key: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  time_zone: string;
  quiet_start: string | null;
  quiet_end: string | null;
  last_lat: number | null;
  last_lon: number | null;
  last_location_at: string | null;
  last_test_at: string | null;
  created_at: string;
}

interface AreaRow {
  id: string;
  subscription_id: string;
  kind: string;
  label: string;
  lat: number | null;
  lon: number | null;
  radius_mi: number;
  state: string | null;
  min_size_in: number;
  mesh: number;
  reports: number;
  warnings: number;
  outlook: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  subscription_id: string;
  area_id: string;
  storm_key: string;
  kind: string;
  title: string;
  body: string;
  place: string;
  size_in: number | null;
  occurred_at: string;
  lat: number | null;
  lon: number | null;
  url: string;
  status: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
}

let ready = false;

function db() {
  const database = getDb();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        device_key TEXT NOT NULL UNIQUE,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        time_zone TEXT NOT NULL DEFAULT 'America/Chicago',
        quiet_start TEXT,
        quiet_end TEXT,
        last_lat REAL,
        last_lon REAL,
        last_location_at TEXT,
        last_test_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_areas (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        lat REAL,
        lon REAL,
        radius_mi REAL NOT NULL,
        state TEXT,
        min_size_in REAL NOT NULL,
        mesh INTEGER NOT NULL,
        reports INTEGER NOT NULL,
        warnings INTEGER NOT NULL,
        outlook INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alert_areas_sub ON alert_areas(subscription_id, created_at);
      CREATE TABLE IF NOT EXISTS alert_events (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        area_id TEXT NOT NULL,
        storm_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        place TEXT NOT NULL,
        size_in REAL,
        occurred_at TEXT NOT NULL,
        lat REAL,
        lon REAL,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        sent_at TEXT,
        UNIQUE(area_id, storm_key)
      );
      CREATE INDEX IF NOT EXISTS idx_alert_events_sub ON alert_events(subscription_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_alert_events_status ON alert_events(status, created_at);
    `);
    ready = true;
  }
  return database;
}

function mapDevice(row: DeviceRow): PushDevice {
  return {
    id: row.id,
    deviceKey: row.device_key,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    timeZone: row.time_zone,
    quietStart: row.quiet_start,
    quietEnd: row.quiet_end,
    lat: row.last_lat,
    lon: row.last_lon,
    locationAt: row.last_location_at,
    lastTestAt: row.last_test_at,
    createdAt: row.created_at,
  };
}

function mapArea(row: AreaRow): AlertArea {
  return {
    id: row.id,
    kind: row.kind as WatchKind,
    label: row.label,
    lat: row.lat,
    lon: row.lon,
    radiusMi: row.radius_mi,
    state: row.state,
    minSizeIn: row.min_size_in,
    mesh: row.mesh === 1,
    reports: row.reports === 1,
    warnings: row.warnings === 1,
    outlook: row.outlook === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): AlertEvent {
  return {
    id: row.id,
    areaId: row.area_id,
    stormKey: row.storm_key,
    kind: row.kind as AlertKind,
    title: row.title,
    body: row.body,
    place: row.place,
    sizeIn: row.size_in,
    occurredAt: row.occurred_at,
    lat: row.lat,
    lon: row.lon,
    url: row.url,
    status: row.status,
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

const PUSH_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);

export function allowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    if (PUSH_HOSTS.has(url.hostname)) return true;
    if (url.hostname.endsWith(".push.apple.com")) return true;
    if (url.hostname.endsWith(".notify.windows.com")) return true;
    return false;
  } catch {
    return false;
  }
}

export function deviceFromKey(deviceKey: string): PushDevice | null {
  const row = db().prepare(`SELECT * FROM push_subscriptions WHERE device_key = ?`).get(deviceKey) as DeviceRow | undefined;
  return row ? mapDevice(row) : null;
}

export function saveSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  timeZone?: string | null;
}): PushDevice {
  const now = new Date().toISOString();
  const existing = db().prepare(`SELECT * FROM push_subscriptions WHERE endpoint = ?`).get(input.endpoint) as DeviceRow | undefined;
  if (existing) {
    db()
      .prepare(
        `UPDATE push_subscriptions SET p256dh = ?, auth = ?, time_zone = COALESCE(?, time_zone), updated_at = ? WHERE id = ?`,
      )
      .run(input.p256dh, input.auth, input.timeZone?.trim() || null, now, existing.id);
    return deviceFromKey(existing.device_key) as PushDevice;
  }
  const id = randomUUID();
  const deviceKey = randomBytes(24).toString("base64url");
  db()
    .prepare(
      `INSERT INTO push_subscriptions (
        id, device_key, endpoint, p256dh, auth, time_zone, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, deviceKey, input.endpoint, input.p256dh, input.auth, input.timeZone?.trim() || "America/Chicago", now, now);
  return deviceFromKey(deviceKey) as PushDevice;
}

export function deleteDevice(id: string) {
  const database = db();
  const tx = database.transaction(() => {
    database.prepare(`DELETE FROM alert_events WHERE subscription_id = ?`).run(id);
    database.prepare(`DELETE FROM alert_areas WHERE subscription_id = ?`).run(id);
    database.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(id);
  });
  tx();
}

export function updateDeviceSettings(
  id: string,
  input: { quietStart?: string | null; quietEnd?: string | null; timeZone?: string | null; lat?: number | null; lon?: number | null },
) {
  const now = new Date().toISOString();
  const current = db().prepare(`SELECT * FROM push_subscriptions WHERE id = ?`).get(id) as DeviceRow | undefined;
  if (!current) return null;
  const lat = input.lat === undefined ? current.last_lat : input.lat;
  const lon = input.lon === undefined ? current.last_lon : input.lon;
  const moved = input.lat !== undefined || input.lon !== undefined;
  db()
    .prepare(
      `UPDATE push_subscriptions
       SET quiet_start = ?, quiet_end = ?, time_zone = ?, last_lat = ?, last_lon = ?,
           last_location_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.quietStart === undefined ? current.quiet_start : input.quietStart,
      input.quietEnd === undefined ? current.quiet_end : input.quietEnd,
      input.timeZone?.trim() || current.time_zone,
      lat,
      lon,
      moved ? now : current.last_location_at,
      now,
      id,
    );
  return deviceFromKey(current.device_key);
}

export function markTestSent(id: string) {
  const now = new Date().toISOString();
  db().prepare(`UPDATE push_subscriptions SET last_test_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
}

export function normalizeArea(input: AreaInput): { area: Omit<AlertArea, "id" | "createdAt" | "updatedAt"> } | { error: string } {
  const kind = input.kind;
  if (kind !== "point" && kind !== "state" && kind !== "near") return { error: "kind must be point, state, or near" };
  const radiusMi = input.radiusMi ?? 25;
    if (kind !== "state" && !isRadiusMi(radiusMi)) return { error: "radius must be 1, 3, 5, 10, or 25 miles" };
  const minSizeIn = input.minSizeIn ?? DEFAULT_PREFS.minSizeIn;
  if (!isThreshold(minSizeIn)) return { error: 'hail size must be any, 1", 1.5", or 2"+' };
  const prefs = {
    minSizeIn,
    mesh: input.mesh ?? DEFAULT_PREFS.mesh,
    reports: input.reports ?? DEFAULT_PREFS.reports,
    warnings: input.warnings ?? DEFAULT_PREFS.warnings,
    outlook: input.outlook ?? DEFAULT_PREFS.outlook,
  };
  if (kind === "state") {
    const state = input.state?.trim().toUpperCase() ?? "";
    if (!US_STATES.some((item) => item.abbr === state)) return { error: "Choose a US state" };
    return {
      area: {
        kind,
        label: (input.label?.trim() || stateName(state)).slice(0, 120),
        lat: null,
        lon: null,
        radiusMi: 0,
        state,
        ...prefs,
      },
    };
  }
  const lat = input.lat ?? null;
  const lon = input.lon ?? null;
  if (kind === "point" && (lat == null || lon == null)) return { error: "A point needs a latitude and longitude" };
  const label = (input.label?.trim() || (kind === "near" ? "Near me" : "Map point")).slice(0, 120);
  if (!label) return { error: "A label is required" };
  return {
    area: {
      kind,
      label,
      lat,
      lon,
      radiusMi,
      state: null,
      ...prefs,
    },
  };
}

export function listAreas(subscriptionId: string): AlertArea[] {
  const rows = db()
    .prepare(`SELECT * FROM alert_areas WHERE subscription_id = ? ORDER BY created_at DESC`)
    .all(subscriptionId) as AreaRow[];
  return rows.map(mapArea);
}

export function addArea(subscriptionId: string, input: AreaInput): { area: AlertArea } | { error: string } {
  const count = db().prepare(`SELECT COUNT(*) AS n FROM alert_areas WHERE subscription_id = ?`).get(subscriptionId) as { n: number };
  if (count.n >= 25) return { error: "This phone already has 25 watch areas" };
  const normalized = normalizeArea(input);
  if ("error" in normalized) return normalized;
  const now = new Date().toISOString();
  const id = randomUUID();
  const area = normalized.area;
  db()
    .prepare(
      `INSERT INTO alert_areas (
        id, subscription_id, kind, label, lat, lon, radius_mi, state, min_size_in, mesh, reports, warnings, outlook, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      subscriptionId,
      area.kind,
      area.label,
      area.lat,
      area.lon,
      area.radiusMi,
      area.state,
      area.minSizeIn,
      area.mesh ? 1 : 0,
      area.reports ? 1 : 0,
      area.warnings ? 1 : 0,
      area.outlook ? 1 : 0,
      now,
      now,
    );
  const row = db().prepare(`SELECT * FROM alert_areas WHERE id = ?`).get(id) as AreaRow;
  return { area: mapArea(row) };
}

export function updateArea(subscriptionId: string, id: string, input: AreaInput): { area: AlertArea } | { error: string } {
  const current = db().prepare(`SELECT * FROM alert_areas WHERE id = ? AND subscription_id = ?`).get(id, subscriptionId) as
    | AreaRow
    | undefined;
  if (!current) return { error: "Watch area not found" };
  const merged: AreaInput = {
    kind: current.kind as WatchKind,
    label: input.label ?? current.label,
    lat: current.lat,
    lon: current.lon,
    radiusMi: input.radiusMi ?? current.radius_mi,
    state: current.state,
    minSizeIn: input.minSizeIn ?? current.min_size_in,
    mesh: input.mesh ?? current.mesh === 1,
    reports: input.reports ?? current.reports === 1,
    warnings: input.warnings ?? current.warnings === 1,
    outlook: input.outlook ?? current.outlook === 1,
  };
  const normalized = normalizeArea(merged);
  if ("error" in normalized) return normalized;
  const area = normalized.area;
  const now = new Date().toISOString();
  db()
    .prepare(
      `UPDATE alert_areas
       SET label = ?, radius_mi = ?, min_size_in = ?, mesh = ?, reports = ?, warnings = ?, outlook = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(area.label, area.radiusMi, area.minSizeIn, area.mesh ? 1 : 0, area.reports ? 1 : 0, area.warnings ? 1 : 0, area.outlook ? 1 : 0, now, id);
  const row = db().prepare(`SELECT * FROM alert_areas WHERE id = ?`).get(id) as AreaRow;
  return { area: mapArea(row) };
}

export function deleteArea(subscriptionId: string, id: string): boolean {
  const result = db().prepare(`DELETE FROM alert_areas WHERE id = ? AND subscription_id = ?`).run(id, subscriptionId);
  if (result.changes) {
    db().prepare(`DELETE FROM alert_events WHERE area_id = ? AND subscription_id = ?`).run(id, subscriptionId);
  }
  return result.changes > 0;
}

export function listInbox(subscriptionId: string, limit = 40): AlertEvent[] {
  const rows = db()
    .prepare(`SELECT * FROM alert_events WHERE subscription_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(subscriptionId, limit) as EventRow[];
  return rows.map(mapEvent);
}

export interface NewAlertEvent {
  subscriptionId: string;
  areaId: string;
  stormKey: string;
  kind: AlertKind;
  title: string;
  body: string;
  place: string;
  sizeIn: number | null;
  occurredAt: string;
  lat: number | null;
  lon: number | null;
  url: string;
  status?: string;
}

export function claimEvent(input: NewAlertEvent): AlertEvent | null {
  const id = randomUUID();
  const now = new Date().toISOString();
  const result = db()
    .prepare(
      `INSERT INTO alert_events (
        id, subscription_id, area_id, storm_key, kind, title, body, place, size_in, occurred_at, lat, lon, url, status, attempts, created_at
      ) VALUES (
        @id, @subscriptionId, @areaId, @stormKey, @kind, @title, @body, @place, @sizeIn, @occurredAt, @lat, @lon, @url, @status, 0, @createdAt
      ) ON CONFLICT(area_id, storm_key) DO NOTHING`,
    )
    .run({
      id,
      subscriptionId: input.subscriptionId,
      areaId: input.areaId,
      stormKey: input.stormKey,
      kind: input.kind,
      title: input.title,
      body: input.body,
      place: input.place,
      sizeIn: input.sizeIn,
      occurredAt: input.occurredAt,
      lat: input.lat,
      lon: input.lon,
      url: input.url,
      status: input.status ?? "pending",
      createdAt: now,
    });
  if (result.changes === 0) return null;
  const row = db().prepare(`SELECT * FROM alert_events WHERE id = ?`).get(id) as EventRow;
  return mapEvent(row);
}

export function markEvent(id: string, status: string) {
  const sentAt = status === "sent" ? new Date().toISOString() : null;
  db()
    .prepare(
      `UPDATE alert_events
       SET status = ?, attempts = attempts + 1, sent_at = COALESCE(?, sent_at)
       WHERE id = ?`,
    )
    .run(status, sentAt, id);
}

export function listRetryEvents(limit = 40): Array<AlertEvent & { subscriptionId: string; attempts: number }> {
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const rows = db()
    .prepare(
      `SELECT * FROM alert_events
       WHERE status IN ('pending', 'failed') AND attempts < 3 AND created_at >= ?
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(since, limit) as EventRow[];
  return rows.map((row) => ({ ...mapEvent(row), subscriptionId: row.subscription_id, attempts: row.attempts }));
}

export function listDevices(): Array<{ device: PushDevice; areas: AlertArea[] }> {
  const devices = (db().prepare(`SELECT * FROM push_subscriptions`).all() as DeviceRow[]).map(mapDevice);
  return devices.map((device) => ({ device, areas: listAreas(device.id) }));
}

export function alertCounts(): { subscriptions: number; areas: number; pending: number } {
  const database = db();
  const subscriptions = (database.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).get() as { n: number }).n;
  const areas = (database.prepare(`SELECT COUNT(*) AS n FROM alert_areas`).get() as { n: number }).n;
  const pending = (database.prepare(`SELECT COUNT(*) AS n FROM alert_events WHERE status IN ('pending', 'failed')`).get() as { n: number }).n;
  return { subscriptions, areas, pending };
}
