import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { dataDir } from "@/lib/db";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "env" | "file";
}

let cached: VapidKeys | null = null;

function subject(): string {
  const configured = process.env.VAPID_SUBJECT?.trim();
  if (configured) return configured;
  return "mailto:diamondstatepdr@gmail.com";
}

function vapidPath(): string {
  return path.join(dataDir(), "vapid.json");
}

function readFileKeys(): { publicKey: string; privateKey: string } | null {
  const file = vapidPath();
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { publicKey?: string; privateKey?: string };
    if (!parsed.publicKey || !parsed.privateKey) return null;
    return { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  } catch {
    return null;
  }
}

function writeFileKeys(keys: { publicKey: string; privateKey: string }) {
  const file = vapidPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(keys), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** Public and private VAPID keys. Env wins. Otherwise load or create vapid.json in the data directory. */
export function getVapid(): VapidKeys {
  if (cached) return cached;
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) {
    cached = { publicKey: envPublic, privateKey: envPrivate, subject: subject(), source: "env" };
    return cached;
  }
  const existing = readFileKeys();
  const keys = existing ?? webpush.generateVAPIDKeys();
  if (!existing) writeFileKeys(keys);
  cached = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: subject(), source: "file" };
  return cached;
}

export function resetVapidCache() {
  cached = null;
}
