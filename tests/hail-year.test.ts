import { describe, expect, it } from "vitest";
import { hailYearChoices, hailYearIntent, hailYearSpan } from "@/lib/hail-year";

const now = new Date("2026-10-26T12:00:00Z");

describe("hail year search", () => {
  it("treats hail-by-year phrases as a browse action, including a partial typed prefix", () => {
    expect(hailYearIntent("hail by year", now)).toEqual({ kind: "browse" });
    expect(hailYearIntent("Hail By Year", now)).toEqual({ kind: "browse" });
    expect(hailYearIntent("yearly hail", now)).toEqual({ kind: "browse" });
    expect(hailYearIntent("hai", now)).toEqual({ kind: "browse" });
  });

  it("picks a single archive year and ignores address searches", () => {
    expect(hailYearIntent("2024", now)).toEqual({ kind: "year", year: 2024 });
    expect(hailYearIntent("hail in 2019", now)).toEqual({ kind: "year", year: 2019 });
    expect(hailYearIntent("hail 2011", now)).toEqual({ kind: "year", year: 2011 });
    expect(hailYearIntent("Flagstaff", now)).toBeNull();
    expect(hailYearIntent("2024 Oak St", now)).toBeNull();
    expect(hailYearIntent("1949", now)).toBeNull();
    expect(hailYearIntent("2027", now)).toBeNull();
  });

  it("spans a calendar year and clamps the current year to today", () => {
    expect(hailYearSpan(2024, now)).toEqual({ start: "2024-01-01", end: "2024-12-31" });
    expect(hailYearSpan(2026, now)).toEqual({ start: "2026-01-01", end: "2026-10-26" });
    expect(hailYearChoices(now)[0]).toBe(2026);
    expect(hailYearChoices(now).at(-1)).toBe(1950);
  });
});
