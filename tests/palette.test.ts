import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paletteFromParam, themeBootScript } from "@/lib/palette";
import { MESH_LEGEND } from "@/lib/mesh-legend";

function channel(hex: string, index: number) {
  const n = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function contrast(a: string, b: string) {
  const lum = (hex: string) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
}

function block(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`missing ${selector}`);
  const vars: Record<string, string> = {};
  for (const part of match[1].split(";")) {
    const row = part.match(/--([\w-]+)\s*:\s*([^;]+)/);
    if (row) vars[row[1]] = row[2].trim();
  }
  return vars;
}

const css = readFileSync(new URL("../src/app/themes.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const TONES = ["map", "storms", "addresses", "field", "reports", "alerts", "money", "chase"];

const palettes = [
  ["A light", ":root"],
  ["B light", 'html[data-palette="b"]'],
  ["C light", 'html[data-palette="c"]'],
  ["A dark", "html.dark"],
  ["B dark", 'html.dark[data-palette="b"]'],
  ["C dark", 'html.dark[data-palette="c"]'],
] as const;

describe("Swathline palettes", () => {
  it("reads review palettes from ?theme= without treating light/dark as a palette", () => {
    expect(paletteFromParam("a")).toBe("a");
    expect(paletteFromParam("b")).toBe("b");
    expect(paletteFromParam("c")).toBe("c");
    expect(paletteFromParam("light")).toBeNull();
    expect(paletteFromParam("dark")).toBeNull();
    expect(paletteFromParam(null)).toBeNull();
  });

  it("keeps the saved light/dark key and does not store the review palette", () => {
    const source = themeBootScript();
    expect(source).toContain('localStorage.getItem("hailmap-theme")');
    expect(source).toContain('setAttribute("data-palette"');
    expect(source).not.toContain("swathline-theme");
    expect(source).not.toContain("localStorage.setItem(\"swathline");
  });

  it("keeps hail-size legend colors out of the theme files", () => {
    expect(MESH_LEGEND.map((band) => band.color)).toEqual(["#65a30d", "#ca8a04", "#ea580c", "#dc2626"]);
    for (const token of ["--low:", "--moderate:", "--high:", "--severe:", "--hail:"]) {
      expect(css).not.toContain(token);
      expect(globals).toContain(token);
    }
  });

  it.each(palettes)("%s meets WCAG AA for text, chips, and section accents", (_name, selector) => {
    const vars = block(css, selector);
    expect(contrast(vars.text, vars.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars.text, vars.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars.muted, vars.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars.muted, vars.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars.accent, vars["accent-ink"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars.cluster, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    const seen = new Set<string>();
    for (const tone of TONES) {
      const color = vars[`tone-${tone}`];
      const ink = vars[`tone-${tone}-ink`];
      expect(color, tone).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(color, vars.panel), `${tone} on panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color, ink), `${tone} chip`).toBeGreaterThanOrEqual(4.5);
      seen.add(color.toLowerCase());
    }
    expect(seen.size).toBe(TONES.length);
  });
});
