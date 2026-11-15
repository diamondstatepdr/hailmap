import { createHash } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import { subscriptionGrantsAccess } from "@/lib/billing";
import { teamOwnerId } from "@/lib/team-store";
import { getAccountById } from "@/lib/user-accounts";

/** Isolates a subscribed account from the shared team-passcode bucket. */
export function accountTeamKey(userId: string): string {
  return createHash("sha256").update(`swathline-account|${userId}`).digest("hex").slice(0, 24);
}

/** Null keeps the existing shared team-passcode records. */
export function accountScope(user: SessionUser): string | null {
  return user.role === "member" ? user.id : null;
}

/**
 * Canvass, leads, forecast prices, and hail-proof company details follow the
 * paying account. A teammate without their own plan uses the owner's key.
 * Undefined lets store helpers keep the passcode team key.
 */
export function memberTeamKey(user: SessionUser): string | undefined {
  if (user.role !== "member") return undefined;
  const account = getAccountById(user.id);
  if (subscriptionGrantsAccess(account?.subscriptionStatus)) return accountTeamKey(user.id);
  const ownerId = teamOwnerId(user.id);
  return accountTeamKey(ownerId ?? user.id);
}
