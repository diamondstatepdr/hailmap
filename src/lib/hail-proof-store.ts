import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { normalizeProof, type HailProof } from "@/lib/hail-proof";

export interface ProofIdentity {
  company: string;
  phone: string;
}

/** One team per server, keyed by the team passcode so every signed-in rep shares it. */
export function proofTeamKey(): string {
  const passcode = process.env.HAILMAP_TEAM_PASSCODE?.trim() ?? "";
  return createHash("sha256").update(`swathline-team|${passcode}`).digest("hex").slice(0, 24);
}

export function readProofIdentity(): ProofIdentity {
  const row = getDb().prepare(`SELECT company, phone FROM proof_identity WHERE team = ?`).get(proofTeamKey()) as
    | ProofIdentity
    | undefined;
  return { company: row?.company ?? "", phone: row?.phone ?? "" };
}

export function saveProofIdentity(company: string, phone: string): ProofIdentity {
  const next = { company: company.trim().slice(0, 80), phone: phone.trim().slice(0, 40) };
  getDb()
    .prepare(
      `INSERT INTO proof_identity (team, company, phone, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(team) DO UPDATE SET company = excluded.company, phone = excluded.phone, updated_at = excluded.updated_at`,
    )
    .run(proofTeamKey(), next.company, next.phone, new Date().toISOString());
  return next;
}

export function saveHailProof(proof: HailProof): HailProof & { id: string } {
  const id = randomUUID();
  getDb()
    .prepare(`INSERT INTO hail_proofs (id, address, payload, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, proof.address, JSON.stringify(proof), proof.createdAt);
  return { ...proof, id };
}

export function readHailProof(id: string): (HailProof & { id: string }) | null {
  if (!/^[0-9a-f-]{16,80}$/i.test(id)) return null;
  const row = getDb().prepare(`SELECT id, payload FROM hail_proofs WHERE id = ?`).get(id) as
    | { id: string; payload: string }
    | undefined;
  if (!row) return null;
  try {
    const raw = JSON.parse(row.payload) as { createdAt?: unknown };
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
    const parsed = normalizeProof(raw, createdAt);
    if ("error" in parsed) return null;
    return { ...parsed, id: row.id };
  } catch {
    return null;
  }
}
