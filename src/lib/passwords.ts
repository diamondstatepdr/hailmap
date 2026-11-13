import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEYLEN = 32;

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "That password is too long.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derived = (await scryptAsync(password.normalize("NFKC"), salt, KEYLEN)) as Buffer;
  return `scrypt$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  if (!salt || !hash) return false;
  let derived: Buffer;
  try {
    derived = (await scryptAsync(password.normalize("NFKC"), salt, KEYLEN)) as Buffer;
  } catch {
    return false;
  }
  const left = Buffer.from(hash, "base64url");
  if (left.length !== derived.length) return false;
  return timingSafeEqual(left, derived);
}
