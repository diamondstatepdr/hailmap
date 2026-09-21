import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, getDb } from "@/lib/db";

/**
 * Photo files live at `$HAILMAP_DATA_DIR/photos/<uuid>.<ext>`.
 * On Railway that directory is `/data/photos` when HAILMAP_DATA_DIR=/data.
 *
 * The map pin is never taken from EXIF. JPEG, PNG, and WebP location metadata
 * is removed before the file is written. HEIC is stored as uploaded because
 * the container is not parsed here; the confirmed pin is still the only location.
 */

const EXTENSIONS = ["jpg", "png", "webp", "heic"] as const;
type PhotoExt = (typeof EXTENSIONS)[number];

const CONTENT_TYPES: Record<PhotoExt, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PHOTO_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|heic)$/i;

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export function maxPhotoBytes(): number {
  const configured = Number(process.env.HAILMAP_PHOTO_MAX_BYTES);
  if (!Number.isFinite(configured) || configured < 1024) return DEFAULT_MAX_BYTES;
  return Math.min(Math.floor(configured), DEFAULT_MAX_BYTES);
}

export function photosDir(): string {
  return path.join(dataDir(), "photos");
}

export function photoUrlFor(photoId: string | null | undefined): string | null {
  if (!photoId || !PHOTO_FILENAME_RE.test(photoId)) return null;
  return `/api/photos/${photoId.replace(/\.(jpg|png|webp|heic)$/i, "")}`;
}

export function detectImage(bytes: Buffer): PhotoExt | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "heic";
  }
  return null;
}

export function stripLocationMetadata(bytes: Buffer, ext: PhotoExt): Buffer {
  if (ext === "jpg") return stripJpegApp1(bytes);
  if (ext === "png") return stripPngText(bytes);
  if (ext === "webp") return stripWebpExif(bytes);
  return bytes;
}

export function savePhoto(bytes: Buffer): { ok: true; filename: string } | { ok: false; error: string } {
  if (bytes.length > maxPhotoBytes()) return { ok: false, error: "Photo is too large (8 MB max)" };
  const ext = detectImage(bytes);
  if (!ext) return { ok: false, error: "Use a JPEG, PNG, WebP, or HEIC photo" };
  const cleaned = stripLocationMetadata(bytes, ext);
  const filename = `${randomUUID()}.${ext}`;
  const dir = photosDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.resolve(dir, filename);
  if (!target.startsWith(path.resolve(dir) + path.sep)) {
    return { ok: false, error: "Could not store that photo" };
  }
  fs.writeFileSync(target, cleaned);
  return { ok: true, filename };
}

export function deletePhoto(filename: string) {
  if (!PHOTO_FILENAME_RE.test(filename)) return;
  const dir = path.resolve(photosDir());
  const target = path.resolve(dir, filename);
  if (!target.startsWith(dir + path.sep)) return;
  fs.rmSync(target, { force: true });
}

export function resolvePhoto(id: string): { absolute: string; contentType: string } | null {
  if (!UUID_RE.test(id)) return null;
  const dir = path.resolve(photosDir());
  for (const ext of EXTENSIONS) {
    const absolute = path.resolve(dir, `${id}.${ext}`);
    if (!absolute.startsWith(dir + path.sep)) return null;
    if (!fs.existsSync(absolute)) continue;
    return { absolute, contentType: CONTENT_TYPES[ext] };
  }
  return null;
}

function limitFromEnv(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  if (!Number.isFinite(configured) || configured < 1) return fallback;
  return Math.floor(configured);
}

/** Count a public photo submit. The address is hashed; the raw IP is not stored. */
export function takePhotoSlot(ip: string): { ok: true } | { ok: false; error: string } {
  const hourly = limitFromEnv("HAILMAP_PHOTO_HOURLY_LIMIT", 8);
  const daily = limitFromEnv("HAILMAP_PHOTO_DAILY_LIMIT", 30);
  const hash = createHash("sha256")
    .update(`hailmap-photo|${ip.slice(0, 80) || "unknown"}`)
    .digest("hex");
  const db = getDb();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86400000).toISOString();
  const hourAgo = new Date(now.getTime() - 3600000).toISOString();
  db.prepare("DELETE FROM photo_submits WHERE created_at < ?").run(dayAgo);
  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS hour_n,
         COUNT(*) AS day_n
       FROM photo_submits
       WHERE ip_hash = ? AND created_at >= ?`,
    )
    .get(hourAgo, hash, dayAgo) as { hour_n: number | null; day_n: number };
  if ((counts.hour_n ?? 0) >= hourly) {
    return { ok: false, error: "Too many photo reports from this network. Try again in an hour." };
  }
  if ((counts.day_n ?? 0) >= daily) {
    return { ok: false, error: "Daily photo report limit reached for this network." };
  }
  db.prepare("INSERT INTO photo_submits (ip_hash, created_at) VALUES (?, ?)").run(hash, now.toISOString());
  return { ok: true };
}

export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 80);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last.slice(0, 80);
  }
  return "unknown";
}

function stripJpegApp1(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input;
  const chunks: Buffer[] = [input.subarray(0, 2)];
  let index = 2;
  while (index + 1 < input.length) {
    if (input[index] !== 0xff) {
      chunks.push(input.subarray(index));
      break;
    }
    const marker = input[index + 1];
    if (marker === 0xff) {
      index += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      chunks.push(input.subarray(index));
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd8) {
      chunks.push(input.subarray(index, index + 2));
      index += 2;
      continue;
    }
    if (index + 4 > input.length) {
      chunks.push(input.subarray(index));
      break;
    }
    const length = input.readUInt16BE(index + 2);
    if (length < 2 || index + 2 + length > input.length) {
      chunks.push(input.subarray(index));
      break;
    }
    if (marker !== 0xe1) chunks.push(input.subarray(index, index + 2 + length));
    index += 2 + length;
  }
  return Buffer.concat(chunks);
}

function stripPngText(input: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (input.length < 8 || !input.subarray(0, 8).equals(signature)) return input;
  const drop = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);
  const out: Buffer[] = [signature];
  let index = 8;
  while (index + 12 <= input.length) {
    const length = input.readUInt32BE(index);
    const type = input.subarray(index + 4, index + 8).toString("ascii");
    const end = index + 12 + length;
    if (end > input.length) break;
    if (!drop.has(type)) out.push(input.subarray(index, end));
    index = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

function stripWebpExif(input: Buffer): Buffer {
  if (input.length < 12 || input.toString("ascii", 0, 4) !== "RIFF" || input.toString("ascii", 8, 12) !== "WEBP") {
    return input;
  }
  const chunks: Buffer[] = [];
  let index = 12;
  while (index + 8 <= input.length) {
    const fourcc = input.toString("ascii", index, index + 4);
    const size = input.readUInt32LE(index + 4);
    const padded = index + 8 + size + (size % 2);
    if (index + 8 + size > input.length) break;
    const end = Math.min(padded, input.length);
    if (fourcc !== "EXIF" && fourcc !== "XMP ") chunks.push(input.subarray(index, end));
    index = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}
