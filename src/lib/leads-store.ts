import { createHash } from "node:crypto";
import { getDb } from "@/lib/db";
import type { LeadRow } from "@/lib/leads";

export function leadTeamKey(): string {
  const passcode = process.env.HAILMAP_TEAM_PASSCODE?.trim() || "default";
  return createHash("sha256").update(`swathline-team|${passcode}`).digest("hex").slice(0, 24);
}

export function listLeads(): LeadRow[] {
  const rows = getDb()
    .prepare(
      `SELECT address, status, rep_name, note, hail_in, updated_at
       FROM canvass_stops
       WHERE team_key = ? AND status IN ('interested', 'signed')
       ORDER BY updated_at DESC, address COLLATE NOCASE`,
    )
    .all(leadTeamKey()) as Array<{
    address: string;
    status: string;
    rep_name: string;
    note: string | null;
    hail_in: number | null;
    updated_at: string;
  }>;
  return rows.flatMap((row) => {
    if (row.status !== "interested" && row.status !== "signed") return [];
    return [
      {
        address: row.address,
        status: row.status,
        rep: row.rep_name,
        note: row.note ?? "",
        date: row.updated_at.slice(0, 10),
        hailIn: row.hail_in,
      },
    ];
  });
}
