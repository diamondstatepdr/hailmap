import { createHash } from "node:crypto";
import type { SessionUser } from "@/lib/auth";

/** Isolates a subscribed account from the shared team-passcode bucket. */
export function accountTeamKey(userId: string): string {
  return createHash("sha256").update(`swathline-account|${userId}`).digest("hex").slice(0, 24);
}

/** Null keeps the existing shared team-passcode records. */
export function accountScope(user: SessionUser): string | null {
  return user.role === "member" ? user.id : null;
}

/** Undefined lets store helpers keep their passcode team key. */
export function memberTeamKey(user: SessionUser): string | undefined {
  return user.role === "member" ? accountTeamKey(user.id) : undefined;
}
