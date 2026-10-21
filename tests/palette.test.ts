import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
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

function boot(search: string, storage: Record<string, string>) {
  const store = { ...storage };
  const html = {
    palette: "",
    dark: false,
    scheme: "",
    meta: "",
  };
  const context = createContext({
    URLSearchParams,
    location: { search },
    localStorage: {
      getItem(key: string) {
        return store[key] ?? null;
      },
      setItem(key: string, value: string) {
        store[key] = value;
      },
    },
    document: {
      documentElement: {
        setAttribute(name: string, value: string) {
          if (name === "data-palette") html.palette = value;
        },
        classList: {
          add(name: string) {
            if (name === "dark") html.dark = true;
          },
        },
        style: {
          set colorScheme(value: string) {
            html.scheme = value;
          },
        },
      },
      querySelector() {
        return {
          setAttribute(_name: string, value: string) {
            html.meta = value;
          },
        };
      },
    },
  });
  runInContext(themeBootScript(), context);
  return { palette: html.palette, dark: html.dark, paletteStored: store["swathline-palette"], schemeStored: store["hailmap-theme"], meta: html.meta };
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

  it("keeps the saved light/dark key and restores the palette before paint", () => {
    const source = themeBootScript();
    expect(source).toContain('localStorage.getItem("hailmap-theme")');
    expect(source).toContain('localStorage.getItem("swathline-palette")');
    expect(source).toContain('localStorage.setItem("swathline-palette"');
    expect(source).toContain('setAttribute("data-palette"');
    expect(source).not.toContain("hailmap-palette");
    expect(boot("", {})).toMatchObject({ palette: "a", dark: false, paletteStored: undefined });
    expect(boot("", { "swathline-palette": "c", "hailmap-theme": "dark" })).toMatchObject({ palette: "c", dark: true });
    expect(boot("?theme=b", { "swathline-palette": "a" })).toMatchObject({ palette: "b", paletteStored: "b" });
    expect(boot("?theme=light", { "swathline-palette": "b", "hailmap-theme": "dark" })).toMatchObject({
      palette: "b",
      dark: false,
      schemeStored: "light",
    });
    expect(boot("?scheme=dark", { "swathline-palette": "c" })).toMatchObject({ palette: "c", dark: true, schemeStored: "dark" });
  });

  it("keeps hail-size legend colors out of the theme files", () => {
    expect(MESH_LEGEND.map((band) => band.color)).toEqual(["#16a34a", "#facc15", "#f97316", "#e11d48", "#d946ef"]);
    expect(MESH_LEGEND.map((band) => band.label)).toEqual(['<1"', '1"', '1.5"', '2"', '2.5"+']);
    expect(MESH_LEGEND.map((band) => band.mapLabel)).toEqual(["<1", "1", "1.5", "2", "2.5+"]);
    for (const band of MESH_LEGEND) expect(band.mapLabel).toMatch(/^[\x20-\x7e]+$/);
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
    expect(contrast(vars["accent-2"], vars["accent-ink"]), "accent-2").toBeGreaterThanOrEqual(4.5);
  });

  it.each(palettes.slice(0, 3))("%s chrome, bands, and glows stay AA and distinct", (_name, selector) => {
    const vars = block(css, selector);
    for (const stop of ["chrome", "chrome-2", "chrome-3"]) {
      expect(contrast(vars["chrome-ink"], vars[stop]), stop).toBeGreaterThanOrEqual(4.5);
    }
    const bands = new Set<string>();
    const glows = new Set<string>();
    for (const tone of TONES) {
      const from = vars[`band-${tone}-from`];
      const to = vars[`band-${tone}-to`];
      expect(contrast(vars["band-ink"], from), `${tone} band from`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars["band-ink"], to), `${tone} band to`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(vars[`glow-${tone}`], vars[`glow-${tone}-ink`]), `${tone} glow`).toBeGreaterThanOrEqual(4.5);
      bands.add(from.toLowerCase());
      glows.add(vars[`glow-${tone}`].toLowerCase());
    }
    expect(bands.size).toBe(TONES.length);
    expect(glows.size).toBe(TONES.length);
  });

  it("tints each dark basemap to its theme", () => {
    const read = (file: string) => JSON.parse(readFileSync(new URL(`../public/map/${file}`, import.meta.url), "utf8"));
    const backgrounds = ["night-a.json", "night-b.json", "night-c.json"].map((file) => {
      const style = read(file);
      return style.layers.find((layer: { id: string }) => layer.id === "background").paint["background-color"];
    });
    expect(new Set(backgrounds).size).toBe(3);
    const motorways = ["night-a.json", "night-b.json", "night-c.json"].map((file) => {
      const style = read(file);
      return JSON.stringify(style.layers.find((layer: { id: string }) => layer.id === "highway_motorway_inner").paint["line-color"]);
    });
    expect(new Set(motorways).size).toBe(3);
    expect(motorways[0]).toContain("#1ba2ba");
    expect(motorways[0]).not.toContain("#22d3ee");
    expect(motorways[1]).toContain("#8a7344");
    expect(motorways[1]).not.toContain("#fbbf24");
    expect(motorways[1]).not.toContain("#c1941f");
    const ember = read("night-b.json");
    const chroma = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
      return Math.max(...channels) - Math.min(...channels);
    };
    for (const id of ["background", "water", "landuse_residential", "landuse_park", "landcover_wood", "building"]) {
      const layer = ember.layers.find((item: { id: string }) => item.id === id);
      const color = layer.paint["background-color"] ?? layer.paint["fill-color"];
      expect(chroma(color), `${id} stays charcoal`).toBeLessThanOrEqual(18);
    }
    const water = ember.layers.find((item: { id: string }) => item.id === "water").paint["fill-color"];
    const waterValue = Number.parseInt(water.slice(1), 16);
    expect((waterValue & 255) >= ((waterValue >> 16) & 255), "water is not brown").toBe(true);
    expect(motorways[2]).toContain("#4ab5a5");
    expect(motorways[2]).not.toContain("#5eead4");
  });
});
