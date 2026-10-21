/** Review-only design directions. Light/dark still uses the existing `hailmap-theme` key. */

export type PaletteId = "a" | "b" | "c";
export type Scheme = "light" | "dark";

export const THEME_COLOR: Record<PaletteId, Record<Scheme, string>> = {
  a: { light: "#e7eefb", dark: "#070b16" },
  b: { light: "#f6f1e8", dark: "#100e0c" },
  c: { light: "#eef3f6", dark: "#0c1216" },
};

/** `?theme=a|b|c` picks a palette for review. `light` and `dark` stay the appearance toggle. */
export function paletteFromParam(value: string | null): PaletteId | null {
  if (value === "a" || value === "b" || value === "c") return value;
  return null;
}

export function activePalette(): PaletteId {
  if (typeof document === "undefined") return "a";
  const value = document.documentElement.dataset.palette;
  return value === "b" || value === "c" ? value : "a";
}

export function applyScheme(scheme: Scheme) {
  const dark = scheme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[activePalette()][scheme]);
}

/**
 * First-paint script. Palette comes from the URL and is not stored.
 * `hailmap-theme` stays the light/dark key so a rename does not drop saved appearance.
 */
export function themeBootScript(): string {
  const colors = JSON.stringify(THEME_COLOR);
  return `(function(){try{var colors=${colors};var p=new URLSearchParams(location.search);var theme=p.get("theme");var scheme=p.get("scheme")||p.get("mode");var palette=theme==="b"||theme==="c"?theme:"a";document.documentElement.setAttribute("data-palette",palette);var stored=null;try{stored=localStorage.getItem("hailmap-theme");}catch(e){}var dark=stored==="dark";if(theme==="dark"||scheme==="dark")dark=true;if(theme==="light"||scheme==="light")dark=false;if(theme==="dark"||theme==="light"){try{localStorage.setItem("hailmap-theme",theme);}catch(e){}}else if(scheme==="dark"||scheme==="light"){try{localStorage.setItem("hailmap-theme",scheme);}catch(e){}}if(dark){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";}var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",colors[palette][dark?"dark":"light"]);}catch(e){}})();`;
}
