import { describe, expect, it } from "vitest";
import { SHORT_SYNC_TTL_MS, syncMaxAgeMs } from "@/lib/ingest";

describe("short-window sync interval", () => {
  it("syncs Live and 1 hour on a sub-minute cap and leaves other views on 10 minutes", () => {
    expect(syncMaxAgeMs(true)).toBe(SHORT_SYNC_TTL_MS);
    expect(SHORT_SYNC_TTL_MS).toBe(45_000);
    expect(syncMaxAgeMs(false)).toBe(10 * 60 * 1000);
  });
});
