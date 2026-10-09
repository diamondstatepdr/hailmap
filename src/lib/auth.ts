import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface SessionUser {
  id: string;
  name: string;
}

const COOKIE = "hailmap_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

export function authConfigured(): boolean {
  return Boolean(process.env.HAILMAP_TEAM_PASSCODE?.trim());
}

function signingKey(): string {
  return process.env.HAILMAP_AUTH_SECRET?.trim() || process.env.HAILMAP_TEAM_PASSCODE?.trim() || "";
}

export function normalizeUserName(name: string): SessionUser | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 60) return null;
  const id = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) return null;
  return { id, name: trimmed };
}

export function verifyPasscode(input: string): boolean {
  const expected = process.env.HAILMAP_TEAM_PASSCODE?.trim() ?? "";
  if (!expected || !input) return false;
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

export function signSession(user: SessionUser): string {
  const body = Buffer.from(
    JSON.stringify({ id: user.id, name: user.name, exp: Date.now() + MAX_AGE_SEC * 1000 }),
  ).toString("base64url");
  const sig = createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | null | undefined): SessionUser | null {
  if (!token || !signingKey()) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", signingKey()).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      id?: unknown;
      name?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string" || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp < Date.now()) return null;
    const user = normalizeUserName(parsed.name);
    if (!user || user.id !== parsed.id) return null;
    return user;
  } catch {
    return null;
  }
}

export function readSession(request: Request): SessionUser | null {
  const header = request.headers.get("cookie") ?? "";
  const parts = header.split(";").map((part) => part.trim());
  const raw = parts.find((part) => part.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  return verifySessionToken(decodeURIComponent(raw.slice(COOKIE.length + 1)));
}

function cookieBase(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(token: string): string {
  return cookieBase(encodeURIComponent(token), MAX_AGE_SEC);
}

export function clearSessionCookie(): string {
  return cookieBase("", 0);
}

export function requireUser(request: Request): { user: SessionUser } | { response: Response } {
  if (!authConfigured()) {
    return {
      response: Response.json(
        { error: "Sign-in is not configured. Set HAILMAP_TEAM_PASSCODE on the server." },
        { status: 503 },
      ),
    };
  }
  const user = readSession(request);
  if (!user) {
    return {
      response: Response.json({ error: "Sign in to use field notes and the watch list." }, { status: 401 }),
    };
  }
  return { user };
}
