import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { leadCsv } from "@/lib/leads";
import { leadTeamKey, listLeads } from "@/lib/leads-store";

describe("lead export", () => {
  it("quotes commas and builds a Sheets file with a BOM and CRLF", () => {
    const csv = leadCsv(
      [
        {
          address: "3500 W 7th St, Fort Worth",
          status: "interested",
          rep: "Alex",
          note: 'Said "call tonight"',
          date: "2026-04-25",
          hailIn: 1.75,
        },
      ],
      false,
    );
    expect(csv).toContain('"3500 W 7th St, Fort Worth"');
    expect(csv).toContain('"Said ""call tonight"""');
    expect(csv.startsWith("Address,Status,Rep,Note,Date,Hail size\n")).toBe(true);
    const sheets = leadCsv(
      [{ address: "1 Main", status: "signed", rep: "Blake", note: "", date: "2026-04-26", hailIn: null }],
      true,
    );
    expect(sheets.charCodeAt(0)).toBe(0xfeff);
    expect(sheets).toContain("\r\n");
    expect(sheets).toContain("Signed,Blake,,2026-04-26,\r\n");
  });

  it("exports only this team's interested and signed stops", () => {
    const db = getDb();
    const team = leadTeamKey();
    db.prepare(`DELETE FROM canvass_stops`).run();
    const insert = db.prepare(
      `INSERT INTO canvass_stops (id, team_key, address_key, address, lat, lon, status, note, hail_in, rep_id, rep_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, 32.75, -97.33, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("a", team, "a", "3500 W 7th St", "interested", "Call tonight", 1.75, "alex", "Alex", "2026-04-25T12:00:00.000Z", "2026-04-25T18:00:00.000Z");
    insert.run("b", team, "b", "10 Camp Bowie", "knocked", null, 1, "alex", "Alex", "2026-04-25T12:00:00.000Z", "2026-04-25T18:00:00.000Z");
    insert.run("c", team, "c", "8 Main", "signed", "Roof", 2, "blake", "Blake", "2026-04-26T12:00:00.000Z", "2026-04-26T15:00:00.000Z");
    insert.run("d", "other-team", "d", "Secret", "signed", null, 2, "sam", "Sam", "2026-04-26T12:00:00.000Z", "2026-04-26T15:00:00.000Z");
    expect(listLeads().map((lead) => [lead.address, lead.status, lead.rep, lead.date, lead.hailIn])).toEqual([
      ["8 Main", "signed", "Blake", "2026-04-26", 2],
      ["3500 W 7th St", "interested", "Alex", "2026-04-25", 1.75],
    ]);
  });
});
