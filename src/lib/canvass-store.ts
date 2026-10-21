import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import {
  addressKey,
  asCanvassStatus,
  clipHail,
  clipNote,
  matchStop,
  preferAddressKey,
  summarizeReps,
  zonedDayRange,
  type CanvassRepCount,
  type CanvassStatus,
  type CanvassStop,
} from "@/lib/canvass";
import { getDb } from "@/lib/db";
import { validLatLon } from "@/lib/geo";

export function currentTeamKey(): string {
  const passcode = process.env.HAILMAP_TEAM_PASSCODE?.trim() || "default";
  return createHash("sha256").update(`swathline-team|${passcode}`).digest("hex").slice(0, 24);
}

interface StopRow {
  id: string;
  address_key: string;
  address: string;
  lat: number;
  lon: number;
  status: string;
  note: string | null;
  hail_in: number | null;
  rep_id: string;
  rep_name: string;
  created_at: string;
  updated_at: string;
}

function mapStop(row: StopRow): CanvassStop | null {
  const status = asCanvassStatus(row.status);
  if (!status) return null;
  return {
    id: row.id,
    addressKey: row.address_key,
    address: row.address,
    lat: row.lat,
    lon: row.lon,
    status,
    note: row.note,
    hailIn: row.hail_in,
    repId: row.rep_id,
    repName: row.rep_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const STOP_SQL = `id, address_key, address, lat, lon, status, note, hail_in, rep_id, rep_name, created_at, updated_at`;

export function listCanvass(bounds?: { west: number; south: number; east: number; north: number } | null): CanvassStop[] {
  const team = currentTeamKey();
  const rows = bounds
    ? (getDb()
        .prepare(
          `SELECT ${STOP_SQL} FROM canvass_stops
           WHERE team_key = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?
           ORDER BY updated_at DESC LIMIT 2000`,
        )
        .all(team, bounds.south - 0.02, bounds.north + 0.02, bounds.west - 0.02, bounds.east + 0.02) as StopRow[])
    : (getDb()
        .prepare(`SELECT ${STOP_SQL} FROM canvass_stops WHERE team_key = ? ORDER BY updated_at DESC LIMIT 2000`)
        .all(team) as StopRow[]);
  return rows.map(mapStop).filter((stop): stop is CanvassStop => Boolean(stop));
}

export function canvassCounts(day: string, timeZone: string): CanvassRepCount[] | null {
  const range = zonedDayRange(day, timeZone);
  if (!range) return null;
  const rows = getDb()
    .prepare(
      `SELECT stop_id AS stopId, rep_id AS repId, rep_name AS repName, status, created_at AS createdAt
       FROM canvass_events
       WHERE team_key = ? AND created_at >= ? AND created_at < ?`,
    )
    .all(currentTeamKey(), range.start.toISOString(), range.end.toISOString()) as Array<{
    stopId: string;
    repId: string;
    repName: string;
    status: string;
    createdAt: string;
  }>;
  return summarizeReps(
    rows.flatMap((row) => {
      const status = asCanvassStatus(row.status);
      if (!status) return [];
      return [{ stopId: row.stopId, repId: row.repId, repName: row.repName, status, createdAt: row.createdAt }];
    }),
  );
}

export function saveCanvass(input: {
  user: SessionUser;
  address: string;
  lat: number;
  lon: number;
  status: CanvassStatus;
  note?: string | null;
  hailIn?: number | null;
}): CanvassStop | null {
  if (!validLatLon(input.lat, input.lon)) return null;
  const address = input.address.trim().replace(/\s+/g, " ").slice(0, 180);
  if (address.length < 2) return null;
  const key = addressKey(address, input.lat, input.lon);
  const note = clipNote(input.note);
  const hailIn = clipHail(input.hailIn);
  const team = currentTeamKey();
  const db = getDb();
  const nearby = listCanvass();
  const found = matchStop(nearby, { addressKey: key, lat: input.lat, lon: input.lon });
  const now = new Date().toISOString();
  const nextKey = found ? preferAddressKey(found.addressKey, key) : key;
  const taken = nextKey !== found?.addressKey
    ? (db.prepare(`SELECT id FROM canvass_stops WHERE team_key = ? AND address_key = ?`).get(team, nextKey) as { id: string } | undefined)
    : undefined;
  const id = taken?.id ?? found?.id ?? randomUUID();
  const createdAt = found?.createdAt ?? now;
  const displayAddress = key.startsWith("addr:") || !found ? address : found.address;
  const write = db.transaction(() => {
    if (found && found.id !== id) {
      db.prepare(`DELETE FROM canvass_stops WHERE id = ? AND team_key = ?`).run(found.id, team);
      db.prepare(`UPDATE canvass_events SET stop_id = ? WHERE stop_id = ? AND team_key = ?`).run(id, found.id, team);
    }
    db.prepare(
      `INSERT INTO canvass_stops (
         id, team_key, address_key, address, lat, lon, status, note, hail_in, rep_id, rep_name, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         address_key = excluded.address_key,
         address = excluded.address,
         lat = excluded.lat,
         lon = excluded.lon,
         status = excluded.status,
         note = excluded.note,
         hail_in = COALESCE(excluded.hail_in, canvass_stops.hail_in),
         rep_id = excluded.rep_id,
         rep_name = excluded.rep_name,
         updated_at = excluded.updated_at`,
    ).run(id, team, nextKey, displayAddress, input.lat, input.lon, input.status, note, hailIn, input.user.id, input.user.name, createdAt, now);
    db.prepare(
      `INSERT INTO canvass_events (id, team_key, stop_id, rep_id, rep_name, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), team, id, input.user.id, input.user.name, input.status, note, now);
  });
  write();
  const row = db.prepare(`SELECT ${STOP_SQL} FROM canvass_stops WHERE id = ?`).get(id) as StopRow | undefined;
  return row ? mapStop(row) : null;
}
