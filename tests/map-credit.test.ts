import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toggleMapCredit, type CreditControl, type CreditEvent } from "@/lib/map-credit";

function control(): CreditControl & { attrs: Map<string, string>; classes: Set<string> } {
  const attrs = new Map<string, string>();
  const classes = new Set<string>(["maplibregl-compact-show"]);
  return {
    attrs,
    classes,
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, value),
    removeAttribute: (name) => attrs.delete(name),
    classList: { remove: (name) => classes.delete(name) },
  };
}

function tap(): CreditEvent & { prevented: number; stopped: number } {
  return {
    prevented: 0,
    stopped: 0,
    preventDefault() {
      this.prevented += 1;
    },
    stopImmediatePropagation() {
      this.stopped += 1;
    },
  };
}

describe("map credit toggle", () => {
  it("opens on the first tap and ignores the duplicate event from that same tap", () => {
    const root = control();
    root.setAttribute("open", "");
    const first = tap();
    expect(toggleMapCredit(root, first)).toBe(true);
    expect(root.getAttribute("data-credit")).toBe("open");
    expect(root.getAttribute("open")).toBe("");
    expect(root.classes.has("maplibregl-compact-show")).toBe(false);
    expect(first.prevented).toBe(1);
    expect(first.stopped).toBe(1);

    const duplicate = tap();
    expect(toggleMapCredit(root, duplicate)).toBe(true);
    expect(root.getAttribute("data-credit")).toBe("open");
    expect(duplicate.prevented).toBe(1);
    expect(duplicate.stopped).toBe(1);
  });

  it("closes on the next tap", async () => {
    const root = control();
    await new Promise((resolve) => setTimeout(resolve, 50));
    toggleMapCredit(root, tap());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toggleMapCredit(root, tap())).toBe(false);
    expect(root.getAttribute("data-credit")).toBe("closed");
    expect(root.getAttribute("open")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(toggleMapCredit(root, tap())).toBe(true);
  });
});

describe("map credit while Money Holes is open", () => {
  it("lifts the phone credit above the bottom sheet", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/div:has\(> \.honey-dock\) \.maplibregl-ctrl-bottom-right\s*\{[^}]*left:\s*0\.55rem;[^}]*bottom:\s*calc\(var\(--honey-stack, calc\(min\(48dvh, 28rem\) \+ 0\.5rem\)\) \+ 1\.35rem\)/);
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.honey-dock\s*\{[^}]*top:/);
  });

  it("keeps the info mark filled and opens toward the map when Money Holes shifts it left", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toContain("fill='%23102033'");
    expect(css).toMatch(/\.maplibregl-ctrl-attrib\.maplibregl-compact\s*\{[^}]*color-scheme:\s*light/);
    expect(css).toMatch(/div:has\(> \.honey-dock\) \.maplibregl-ctrl-attrib\[data-credit="open"\] \.maplibregl-ctrl-attrib-inner\s*\{[^}]*left:\s*0;/);
  });
});

describe("map search contrast", () => {
  it("paints the map search on a dark field with readable suggestion text", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.map-topbar \.address-search-input\s*\{[^}]*color-scheme:\s*dark/);
    expect(css).toMatch(/\.map-topbar \.address-search button\s*\{[^}]*color:\s*var\(--text\)/);
    expect(css).toMatch(/\.map-topbar \.address-search-icon\s*\{[^}]*color:\s*var\(--chrome-ink\)/);
  });
});
