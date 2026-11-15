import { randomBytes, randomUUID } from "node:crypto";
import type { SessionUser } from "@/lib/auth";
import { subscriptionGrantsAccess, tierForPrice } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { seatCapForTier, teamNotice } from "@/lib/seats";
import { getAccountByEmail, getAccountById, normalizeEmail, type AccountRow } from "@/lib/user-accounts";

export interface OpenInvite {
  id: string;
  email: string;
  token: string;
  createdAt: string;
}

export interface TeamOverview {
  role: "owner" | "mate" | "passcode";
  ownerName: string | null;
  planName: string | null;
  active: boolean;
  cap: number;
  people: number;
  pending: number;
  overCap: boolean;
  canInvite: boolean;
  notice: string | null;
  members: Array<{ id: string; name: string; email: string }>;
  invites: OpenInvite[];
}

interface InviteRow {
  id: string;
  owner_id: string;
  email: string;
  token: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

function countMembers(ownerId: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM team_members WHERE owner_id = ?`).get(ownerId) as { n: number };
  return row.n;
}

function countPending(ownerId: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM team_invites WHERE owner_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`)
    .get(ownerId) as { n: number };
  return row.n;
}

export function teamOwnerId(memberId: string): string | null {
  const row = getDb().prepare(`SELECT owner_id FROM team_members WHERE member_id = ?`).get(memberId) as
    | { owner_id: string }
    | undefined;
  return row?.owner_id ?? null;
}

/** The paying account for someone who joined a team. Null when they are not on one. */
export function teamPayer(memberId: string): AccountRow | null {
  const ownerId = teamOwnerId(memberId);
  if (!ownerId) return null;
  return getAccountById(ownerId);
}

function openInviteForEmail(email: string): InviteRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, owner_id, email, token, created_at, accepted_at, revoked_at
       FROM team_invites WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    )
    .get(email) as InviteRow | undefined;
}

function mapInvite(row: InviteRow): OpenInvite {
  return { id: row.id, email: row.email, token: row.token, createdAt: row.created_at };
}

export function createInvite(ownerId: string, emailRaw: string): { ok: true; invite: OpenInvite; created: boolean } | { ok: false; status: number; error: string } {
  const email = normalizeEmail(emailRaw);
  if (!email) return { ok: false, status: 400, error: "Enter a valid email address." };
  const owner = getAccountById(ownerId);
  if (!owner) return { ok: false, status: 403, error: "Sign in with the account that pays for the plan." };
  if (email === owner.email) return { ok: false, status: 400, error: "That's your email. You're already on the plan." };
  if (teamOwnerId(ownerId)) {
    return { ok: false, status: 403, error: "You're on someone else's team. Only the person who pays can invite people." };
  }

  const write = getDb().transaction(() => {
    const existing = openInviteForEmail(email);
    if (existing) {
      if (existing.owner_id !== ownerId) {
        return { ok: false as const, status: 409, error: "That person already has an invite from another team." };
      }
      return { ok: true as const, invite: mapInvite(existing), created: false };
    }

    const tierId = tierForPrice(owner.subscriptionPriceId)?.id ?? null;
    const gate = teamNotice({
      tierId,
      active: subscriptionGrantsAccess(owner.subscriptionStatus),
      members: countMembers(ownerId),
      pending: countPending(ownerId),
    });
    if (!gate.canInvite) {
      return { ok: false as const, status: 403, error: gate.notice ?? "You can't add anyone on this plan." };
    }

    const target = getAccountByEmail(email);
    if (target) {
      if (subscriptionGrantsAccess(target.subscriptionStatus)) {
        return { ok: false as const, status: 409, error: "That person already has their own plan." };
      }
      if (teamOwnerId(target.id)) {
        return { ok: false as const, status: 409, error: "That person is already on another team." };
      }
      const onThis = getDb().prepare(`SELECT 1 AS n FROM team_members WHERE owner_id = ? AND member_id = ?`).get(ownerId, target.id);
      if (onThis) return { ok: false as const, status: 409, error: "That person is already on the team." };
    }

    const invite: InviteRow = {
      id: `inv_${randomUUID()}`,
      owner_id: ownerId,
      email,
      token: randomBytes(32).toString("base64url"),
      created_at: new Date().toISOString(),
      accepted_at: null,
      revoked_at: null,
    };
    getDb()
      .prepare(`INSERT INTO team_invites (id, owner_id, email, token, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(invite.id, invite.owner_id, invite.email, invite.token, invite.created_at);
    return { ok: true as const, invite: mapInvite(invite), created: true };
  });

  return write();
}

export function revokeInvite(ownerId: string, inviteId: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE team_invites SET revoked_at = ?
       WHERE id = ? AND owner_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    )
    .run(new Date().toISOString(), inviteId, ownerId);
  return result.changes > 0;
}

export function removeMember(ownerId: string, memberId: string): boolean {
  const result = getDb().prepare(`DELETE FROM team_members WHERE owner_id = ? AND member_id = ?`).run(ownerId, memberId);
  return result.changes > 0;
}

export function previewInvite(token: string): { email: string; ownerName: string; planName: string; status: "open" | "accepted" | "revoked" } | null {
  const invite = getDb()
    .prepare(`SELECT id, owner_id, email, token, created_at, accepted_at, revoked_at FROM team_invites WHERE token = ?`)
    .get(token) as InviteRow | undefined;
  if (!invite) return null;
  const owner = getAccountById(invite.owner_id);
  const planName = tierForPrice(owner?.subscriptionPriceId)?.name ?? "plan";
  const status = invite.revoked_at ? "revoked" : invite.accepted_at ? "accepted" : "open";
  return { email: invite.email, ownerName: owner?.name ?? "Your crew", planName, status };
}

export function acceptInvite(token: string, user: { id: string; email: string }): { ok: true } | { ok: false; status: number; error: string } {
  const email = normalizeEmail(user.email);
  if (!email) return { ok: false, status: 403, error: "Sign in with the invited email." };

  const write = getDb().transaction(() => {
    const invite = getDb()
      .prepare(`SELECT id, owner_id, email, token, created_at, accepted_at, revoked_at FROM team_invites WHERE token = ?`)
      .get(token) as InviteRow | undefined;
    if (!invite) return { ok: false as const, status: 404, error: "This invite link is not valid." };
    if (invite.revoked_at) return { ok: false as const, status: 410, error: "This invite was canceled. Ask for a new link." };
    if (invite.accepted_at) {
      const same = getDb().prepare(`SELECT 1 AS n FROM team_members WHERE owner_id = ? AND member_id = ?`).get(invite.owner_id, user.id);
      if (same) return { ok: true as const };
      return { ok: false as const, status: 410, error: "This invite was already used." };
    }
    if (email !== invite.email) return { ok: false as const, status: 403, error: `Sign in as ${invite.email} to join this team.` };
    if (user.id === invite.owner_id) return { ok: false as const, status: 400, error: "You're already the owner of this plan." };

    const account = getAccountById(user.id);
    if (!account) return { ok: false as const, status: 401, error: "Sign in to join this team." };
    if (subscriptionGrantsAccess(account.subscriptionStatus)) {
      return { ok: false as const, status: 409, error: "You already have your own plan." };
    }
    const other = teamOwnerId(user.id);
    if (other === invite.owner_id) return { ok: true as const };
    if (other) return { ok: false as const, status: 409, error: "You're already on another team." };

    const owner = getAccountById(invite.owner_id);
    const capTier = tierForPrice(owner?.subscriptionPriceId)?.id ?? null;
    const active = subscriptionGrantsAccess(owner?.subscriptionStatus);
    if (!active) return { ok: false as const, status: 403, error: "That plan is not active, so this invite can't be used." };
    if (1 + countMembers(invite.owner_id) >= seatCapForTier(capTier)) {
      return { ok: false as const, status: 403, error: "This team is full right now." };
    }

    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO team_members (owner_id, member_id, created_at) VALUES (?, ?, ?)`).run(invite.owner_id, user.id, now);
    getDb().prepare(`UPDATE team_invites SET accepted_at = ? WHERE id = ?`).run(now, invite.id);
    return { ok: true as const };
  });

  return write();
}

export function teamOverview(user: SessionUser): TeamOverview {
  if (user.role !== "member") {
    return {
      role: "passcode",
      ownerName: null,
      planName: null,
      active: false,
      cap: 1,
      people: 1,
      pending: 0,
      overCap: false,
      canInvite: false,
      notice: null,
      members: [],
      invites: [],
    };
  }

  const account = getAccountById(user.id);
  const payer = teamPayer(user.id);
  const ownActive = subscriptionGrantsAccess(account?.subscriptionStatus);
  if (payer && !ownActive) {
    const planName = tierForPrice(payer.subscriptionPriceId)?.name ?? "plan";
    const active = subscriptionGrantsAccess(payer.subscriptionStatus);
    return {
      role: "mate",
      ownerName: payer.name,
      planName,
      active,
      cap: 0,
      people: 0,
      pending: 0,
      overCap: false,
      canInvite: false,
      notice: active
        ? `You're on ${payer.name}'s ${planName} plan. The sales tools are included. You don't pay separately. If their plan ends, the tools close for you too.`
        : `${payer.name}'s plan is not active, so the sales tools are closed for you too.`,
      members: [],
      invites: [],
    };
  }

  const tier = tierForPrice(account?.subscriptionPriceId ?? null);
  const members = getDb()
    .prepare(
      `SELECT u.id AS id, u.name AS name, u.email AS email
       FROM team_members m JOIN users u ON u.id = m.member_id
       WHERE m.owner_id = ? ORDER BY m.created_at ASC`,
    )
    .all(user.id) as Array<{ id: string; name: string; email: string }>;
  const invites = (
    getDb()
      .prepare(
        `SELECT id, owner_id, email, token, created_at, accepted_at, revoked_at
         FROM team_invites
         WHERE owner_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
         ORDER BY created_at ASC`,
      )
      .all(user.id) as InviteRow[]
  ).map(mapInvite);
  const gate = teamNotice({
    tierId: tier?.id ?? null,
    active: ownActive,
    members: members.length,
    pending: invites.length,
  });
  return {
    role: "owner",
    ownerName: account?.name ?? user.name,
    planName: tier?.name ?? null,
    active: ownActive,
    cap: tier?.seats ?? 1,
    people: 1 + members.length,
    pending: invites.length,
    overCap: gate.overCap,
    canInvite: gate.canInvite,
    notice: gate.notice,
    members: members.flatMap((member) => (member.email ? [member] : [])),
    invites,
  };
}
