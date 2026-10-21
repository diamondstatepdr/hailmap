import { describe, expect, it } from "vitest";
import { ABOUT_3_MI, timeZoneAt } from "@/lib/proof-confirm";
import { loadProofConfirm } from "@/lib/proof-confirm-load";

describe("proof confirmation window", () => {
  it("uses Mesa local time and a radius of about 3 miles", () => {
    expect(timeZoneAt(33.415, -111.837)).toBe("America/Phoenix");
    expect(ABOUT_3_MI).toBeGreaterThan(3);
    expect(ABOUT_3_MI).toBeLessThan(3.5);
  });

  const live = process.env.PROOF_LIVE === "1" ? it : it.skip;
  live(
    "matches the Oct 20 2026 Mesa scan to NOAA spotter reports",
    async () => {
      process.env.HAILMAP_DATA_DIR = process.env.HAILMAP_DATA_DIR || "/tmp/swathline-proof";
      const confirm = await loadProofConfirm({ lat: 33.415, lon: -111.837, stormDate: "2026-10-20" });
      console.log(JSON.stringify(confirm, null, 2));
      expect(confirm.radarKind).toBe("scan");
      expect(confirm.radarIn ?? 0).toBeGreaterThanOrEqual(1);
      expect(confirm.seal).toBe(true);
      expect(confirm.headline).toBe("Radar + spotter confirmed");
      expect(confirm.reports.length).toBeGreaterThan(0);
      expect(confirm.reports.some((report) => /mPING|PSR|Local Storm Report/.test(report.source))).toBe(true);
      expect(confirm.radarLine).toMatch(/Oct 20, \d{1,2}:\d{2} [AP]M MST \(\d{2}:\d{2} UTC\)/);
      expect(confirm.radarLine).not.toMatch(/2026-10-21/);
      expect(confirm.reports.every((report) => !/\d{4}-\d{2}-\d{2}/.test(report.timeUtc))).toBe(true);
      expect(confirm.disclaimer).toContain("not a meteorologist certification");
    },
    180000,
  );
});
