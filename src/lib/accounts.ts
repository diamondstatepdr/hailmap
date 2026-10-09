import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { haversineKm, validLatLon } from "@/lib/geo";
import type { GeocodeHit } from "@/lib/forward-geocode";
import { asDamageType, asPinStatus, type FieldDamageType, type PinStatus } from "@/lib/field";
import { photoUrlFor, deletePhoto } from "@/lib/photos";
import type { SessionUser } from "@/lib/auth";

export { asDamageType, asPinStatus };
export type { FieldDamageType, PinStatus };

export function upsertUser(user: SessionUser) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    )
    .run(user.id, user.name, now);
}

export interface WatchPlace {
  id: string;
  label: string;
  query: string;
  lat: number;
  lon: number;
  radiusKm: number;
  createdAt: string;
}

export function listWatch(userId: string): WatchPlace[] {
  const rows = getDb()
    .prepare(
      `SELECT id, label, query, lat, lon, radius_km AS radiusKm, created_at AS createdAt
       FROM watch_places WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .all(userId) as WatchPlace[];
  return rows;
}

export function addWatch(input: {
  userId: string;
  label: string;
  query: string;
  lat: number;
  lon: number;
  radiusKm: number;
}): WatchPlace | null {
  if (!validLatLon(input.lat, input.lon)) return null;
  const label = input.label.trim().slice(0, 160);
  const query = input.query.trim().slice(0, 160);
  if (!label) return null;
  const place: WatchPlace = {
    id: randomUUID(),
    label,
    query: query || label,
    lat: input.lat,
    lon: input.lon,
    radiusKm: input.radiusKm,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO watch_places (id, user_id, label, query, lat, lon, radius_km, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(place.id, input.userId, place.label, place.query, place.lat, place.lon, place.radiusKm, place.createdAt);
  return place;
}

export function deleteWatch(userId: string, id: string): boolean {
  const result = getDb().prepare(`DELETE FROM watch_places WHERE id = ? AND user_id = ?`).run(id, userId);
  return result.changes > 0;
}

export interface FieldPhoto {
  id: string;
  photoId: string;
  photoUrl: string | null;
  damageType: FieldDamageType;
  note: string | null;
  takenAt: string;
}

export interface FieldPin {
  id: string;
  lat: number;
  lon: number;
  status: PinStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  photos: FieldPhoto[];
}

interface PinRow {
  id: string;
  lat: number;
  lon: number;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PhotoRow {
  id: string;
  pin_id: string;
  photo_id: string;
  damage_type: string;
  note: string | null;
  taken_at: string;
}

function photosByPin(userId: string): Map<string, FieldPhoto[]> {
  const rows = getDb()
    .prepare(
      `SELECT id, pin_id, photo_id, damage_type, note, taken_at FROM field_photos WHERE user_id = ? ORDER BY taken_at DESC`,
    )
    .all(userId) as PhotoRow[];
  const grouped = new Map<string, FieldPhoto[]>();
  for (const row of rows) {
    const damageType = asDamageType(row.damage_type);
    if (!damageType) continue;
    const list = grouped.get(row.pin_id) ?? [];
    list.push({
      id: row.id,
      photoId: row.photo_id,
      photoUrl: photoUrlFor(row.photo_id),
      damageType,
      note: row.note,
      takenAt: row.taken_at,
    });
    grouped.set(row.pin_id, list);
  }
  return grouped;
}

export function listPins(userId: string): FieldPin[] {
  const rows = getDb()
    .prepare(
      `SELECT id, lat, lon, status, note, created_at AS createdAt, updated_at AS updatedAt
       FROM field_pins WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500`,
    )
    .all(userId) as PinRow[];
  const photos = photosByPin(userId);
  return rows.flatMap((row) => {
    const status = asPinStatus(row.status);
    if (!status) return [];
    return [{ ...row, status, photos: photos.get(row.id) ?? [] }];
  });
}

export function pinsInRadius(userId: string, lat: number, lon: number, radiusKm: number): FieldPin[] {
  return listPins(userId).filter((pin) => haversineKm(lat, lon, pin.lat, pin.lon) <= radiusKm);
}

export function pinsInBounds(
  userId: string,
  bounds: { west: number; south: number; east: number; north: number },
): FieldPin[] {
  return listPins(userId).filter(
    (pin) => pin.lon >= bounds.west && pin.lon <= bounds.east && pin.lat >= bounds.south && pin.lat <= bounds.north,
  );
}

export function createPin(input: {
  userId: string;
  lat: number;
  lon: number;
  status: PinStatus;
  note: string | null;
}): FieldPin | null {
  if (!validLatLon(input.lat, input.lon)) return null;
  const now = new Date().toISOString();
  const pin: FieldPin = {
    id: randomUUID(),
    lat: input.lat,
    lon: input.lon,
    status: input.status,
    note: input.note,
    createdAt: now,
    updatedAt: now,
    photos: [],
  };
  getDb()
    .prepare(
      `INSERT INTO field_pins (id, user_id, lat, lon, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(pin.id, input.userId, pin.lat, pin.lon, pin.status, pin.note, pin.createdAt, pin.updatedAt);
  return pin;
}

export function updatePin(
  userId: string,
  id: string,
  patch: { status?: PinStatus; note?: string | null },
): FieldPin | null {
  const existing = listPins(userId).find((pin) => pin.id === id);
  if (!existing) return null;
  const status = patch.status ?? existing.status;
  const note = patch.note === undefined ? existing.note : patch.note;
  const updatedAt = new Date().toISOString();
  getDb()
    .prepare(`UPDATE field_pins SET status = ?, note = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(status, note, updatedAt, id, userId);
  return { ...existing, status, note, updatedAt };
}

export function deletePin(userId: string, id: string): boolean {
  const photos = getDb()
    .prepare(`SELECT photo_id FROM field_photos WHERE pin_id = ? AND user_id = ?`)
    .all(id, userId) as { photo_id: string }[];
  const result = getDb().prepare(`DELETE FROM field_pins WHERE id = ? AND user_id = ?`).run(id, userId);
  if (!result.changes) return false;
  getDb().prepare(`DELETE FROM field_photos WHERE pin_id = ? AND user_id = ?`).run(id, userId);
  for (const photo of photos) deletePhoto(photo.photo_id);
  return true;
}

export function addFieldPhoto(input: {
  userId: string;
  pinId: string;
  photoId: string;
  damageType: FieldDamageType;
  note: string | null;
  takenAt: string;
}): FieldPhoto | null {
  const pin = getDb()
    .prepare(`SELECT id FROM field_pins WHERE id = ? AND user_id = ?`)
    .get(input.pinId, input.userId) as { id: string } | undefined;
  if (!pin) return null;
  const photo: FieldPhoto = {
    id: randomUUID(),
    photoId: input.photoId,
    photoUrl: photoUrlFor(input.photoId),
    damageType: input.damageType,
    note: input.note,
    takenAt: input.takenAt,
  };
  getDb()
    .prepare(
      `INSERT INTO field_photos (id, pin_id, user_id, photo_id, damage_type, note, taken_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      photo.id,
      input.pinId,
      input.userId,
      photo.photoId,
      photo.damageType,
      photo.note,
      photo.takenAt,
      new Date().toISOString(),
    );
  getDb().prepare(`UPDATE field_pins SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), input.pinId);
  return photo;
}

export interface StoredStormReport {
  id: string;
  userId: string | null;
  title: string;
  createdAt: string;
  payload: unknown;
}

export function saveStormReport(userId: string | null, title: string, payload: unknown, id = randomUUID()): string {
  const createdAt = new Date().toISOString();
  getDb()
    .prepare(`INSERT INTO storm_reports (id, user_id, title, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, userId, title.slice(0, 180), JSON.stringify(payload), createdAt);
  return id;
}

export function listStormReports(userId: string): Array<{ id: string; title: string; createdAt: string }> {
  return getDb()
    .prepare(
      `SELECT id, title, created_at AS createdAt FROM storm_reports WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(userId) as Array<{ id: string; title: string; createdAt: string }>;
}

export function getStormReport(id: string): StoredStormReport | null {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = getDb()
    .prepare(`SELECT id, user_id AS userId, title, payload, created_at AS createdAt FROM storm_reports WHERE id = ?`)
    .get(id) as { id: string; userId: string | null; title: string; payload: string; createdAt: string } | undefined;
  if (!row) return null;
  try {
    return { id: row.id, userId: row.userId, title: row.title, createdAt: row.createdAt, payload: JSON.parse(row.payload) };
  } catch {
    return null;
  }
}

interface CacheRow {
  payload: string;
  fetched_at: string;
}

export function readGeocodeCache(query: string): { places: GeocodeHit[]; at: number } | null {
  const row = getDb().prepare(`SELECT payload, fetched_at FROM geocode_cache WHERE query = ?`).get(query) as
    | CacheRow
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as { places?: GeocodeHit[]; exp?: number };
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return { places: parsed.places ?? [], at: Date.parse(row.fetched_at) };
  } catch {
    return null;
  }
}

export function writeGeocodeCache(query: string, places: GeocodeHit[], ttlMs: number) {
  getDb()
    .prepare(
      `INSERT INTO geocode_cache (query, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(query, JSON.stringify({ places, exp: Date.now() + ttlMs }), new Date().toISOString());
}

export function takeActionSlot(
  ipHash: string,
  kind: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; error: string } {
  const db = getDb();
  const since = new Date(Date.now() - windowMs).toISOString();
  db.prepare(`DELETE FROM action_limits WHERE created_at < ?`).run(new Date(Date.now() - 48 * 3600000).toISOString());
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM action_limits WHERE kind = ? AND ip_hash = ? AND created_at >= ?`)
    .get(kind, ipHash, since) as { n: number };
  if (row.n >= limit) return { ok: false, error: "Too many requests. Try again later." };
  db.prepare(`INSERT INTO action_limits (ip_hash, kind, created_at) VALUES (?, ?, ?)`).run(
    ipHash,
    kind,
    new Date().toISOString(),
  );
  return { ok: true };
}
