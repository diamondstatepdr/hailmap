import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { normalizeProof, type HailProof } from "@/lib/hail-proof";

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
