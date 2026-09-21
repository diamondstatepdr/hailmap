import { describe, expect, it } from "vitest";
import { extractDamageTags } from "@/lib/damage";

describe("extractDamageTags", () => {
  it("finds vehicle, window, and roof damage", () => {
    expect(extractDamageTags("Broke car windows and stripped roof shingles")).toEqual([
      "vehicle",
      "roof",
      "window",
    ]);
  });

  it("is case insensitive and does not repeat tags", () => {
    expect(extractDamageTags("WINDSHIELD cracked")).toEqual(["vehicle", "window"]);
    expect(extractDamageTags("roof and roof shingles")).toEqual(["roof"]);
  });

  it("tags crops, trees, power, and structures", () => {
    expect(extractDamageTags("corn flattened")).toEqual(["crop"]);
    expect(extractDamageTags("power lines down, tree limbs on the house")).toEqual([
      "tree",
      "power",
      "structure",
    ]);
  });

  it("returns an empty list when there is no remark", () => {
    expect(extractDamageTags("")).toEqual([]);
    expect(extractDamageTags(null)).toEqual([]);
    expect(extractDamageTags("hail only, no mention of impact")).toEqual([]);
  });
});
