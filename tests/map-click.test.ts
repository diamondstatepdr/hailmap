import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chooseMapClick } from "@/lib/map-click";

describe("map click target", () => {
  it("opens the hail report when the tap also hits the swath underneath", () => {
    const choice = chooseMapClick([
      { layerId: "mesh-fill", id: "mesh-1" },
      { layerId: "swath-fill", id: "swath-1" },
      { layerId: "hail-points", id: "report-pennsauken" },
    ]);
    expect(choice).toEqual({ type: "report", id: "report-pennsauken" });
  });

  it("opens a nearby report dot ahead of a MESH band", () => {
    const choice = chooseMapClick([
      { layerId: "mesh-a-fill", id: "band" },
      { layerId: "hail-point-hit", id: "report-burlington" },
    ]);
    expect(choice).toEqual({ type: "report", id: "report-burlington" });
  });

  it("leaves a swath tap as a swath, not a report, when no dot is under the finger", () => {
    expect(chooseMapClick([{ layerId: "mesh-fill", id: "mesh-1" }])).toEqual({ type: "swath" });
    expect(chooseMapClick([{ layerId: "swath-fill", id: "swath-1" }])).toEqual({ type: "swath" });
    expect(chooseMapClick([])).toEqual({ type: "other" });
  });

  it("does not start the dealer search from the swath click", () => {
    const source = readFileSync(new URL("../src/components/HailApp.tsx", import.meta.url), "utf8");
    const start = source.indexOf("onSelectArea={(selection)");
    const end = source.indexOf("onSelectDealer", start);
    const handler = source.slice(start, end);
    expect(handler).not.toContain("loadDealers");
    expect(handler).not.toContain("denySales");
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const chip = css.slice(css.indexOf(".account-chip {"), css.indexOf(".btn-primary"));
    expect(chip).toMatch(/top:\s*max\(/);
    expect(chip).toContain("right: 6.4rem");
    expect(chip).not.toContain("4.6rem");
  });

  it("expands a hail cluster before opening the polygon under it", () => {
    expect(
      chooseMapClick([
        { layerId: "mesh-fill", id: "mesh-1" },
        { layerId: "hail-clusters", clusterId: 4 },
      ]),
    ).toEqual({ type: "hail-cluster", clusterId: 4 });
  });
});
