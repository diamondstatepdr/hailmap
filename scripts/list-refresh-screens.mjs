import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.REFRESH_SHOTS ?? "/opt/cursor/artifacts/screens";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

// Oct 19, 2026 Deming has radar swaths in the MRMS day grid (about 2.2").
// These rows are that day's own Money Hole ranking (distinct lots and counts).
// The live /api/honey answer stays partial until Overpass finishes, and the panel
// hides a partial ranking, so the shot serves this finished copy. Mesh is not mocked.
const storm = { lat: 32.2, lon: -107.76, z: 10, day: "2026-10-19" };
const updatedAt = "2026-10-21T12:41:17.595Z";

const honey = {
  date: storm.day,
  label: "Oct 19, 2026",
  live: false,
  partial: false,
  status: "complete",
  zoom: false,
  note: null,
  attribution: "Lots and apartments © OpenStreetMap contributors. Homes from US Census ACS housing units. Hail from radar estimates and official spotter reports.",
  updatedAt,
  spots: {
    pdr: [
      { id: "post", name: "Post Apartments area", kind: "apartments", lat: 32.2692, lon: -107.747, hailIn: 2.23, radarIn: 2.23, spotterIn: 1.25, vehicles: 1608, homes: 28, score: 86, level: "Very High", distanceKm: 1.6, sourceLabel: "Radar and spotter agree" },
      { id: "palmas", name: "Las Palmas Apartments area", kind: "apartments", lat: 32.2582, lon: -107.7625, hailIn: 2.23, radarIn: 2.23, spotterIn: 1.25, vehicles: 1174, homes: 28, score: 85, level: "Very High", distanceKm: 0.3, sourceLabel: "Radar and spotter agree" },
      { id: "sierra", name: "Sierra Vista Apartments area", kind: "apartments", lat: 32.2807, lon: -107.7626, hailIn: 2.23, radarIn: 2.23, spotterIn: 1.25, vehicles: 337, homes: 56, score: 79, level: "Very High", distanceKm: 2.3, sourceLabel: "Radar and spotter agree" },
      { id: "sw", name: "Deming southwest", kind: "parking", lat: 32.2497, lon: -107.7884, hailIn: 2.03, radarIn: 2.03, spotterIn: 1.25, vehicles: 412, homes: null, score: 76, level: "Very High", distanceKm: 2.9, sourceLabel: "Radar and spotter agree" },
      { id: "north", name: "Deming north", kind: "parking", lat: 32.2809, lon: -107.7696, hailIn: 2.09, radarIn: 2.09, spotterIn: 1.25, vehicles: 192, homes: null, score: 72, level: "Very High", distanceKm: 2.5, sourceLabel: "Radar and spotter agree" },
    ],
    roof: [],
  },
  heat: { pdr: { type: "FeatureCollection", features: [] }, roof: { type: "FeatureCollection", features: [] } },
};

function overlaps(a, b) {
  return a.bottom > b.top + 1 && a.top < b.bottom - 1 && a.right > b.left + 1 && a.left < b.right - 1;
}

async function install(page) {
  await page.route("**/api/honey?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(honey) });
  });
}

async function shot(page, name) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  const text = await page.locator("[data-updated]").first().innerText();
  if (!text.includes("Updated")) throw new Error(`${name} missing Updated line: ${text}`);
  await page.screenshot({ path: `${outDir}/${name}.png` });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const themes = [
    ["a", "dark", "storm-core-dark"],
    ["b", "dark", "supercell-dark"],
    ["c", "dark", "ice-swath-dark"],
    ["a", "light", "storm-core-light"],
    ["b", "light", "supercell-light"],
    ["c", "light", "ice-swath-light"],
  ];
  const url = `${base}/?lat=${storm.lat}&lon=${storm.lon}&z=${storm.z}&day=${storm.day}`;
  for (const [theme, scheme, name] of themes) {
    const context = await browser.newContext({ ...phone, serviceWorkers: "block" });
    const page = await context.newPage();
    await install(page);
    const meshReady = page.waitForResponse(async (response) => {
      if (!response.url().includes(`/api/mesh?date=${storm.day}`) || !response.ok()) return false;
      const payload = await response.json().catch(() => null);
      return (payload?.collection?.features?.length ?? 0) > 0;
    });
    await page.goto(`${url}&theme=${theme}&scheme=${scheme}`, { waitUntil: "domcontentloaded" });
    await page.locator(".maplibregl-map").waitFor({ timeout: 20000 });
    await meshReady;
    await page.locator(".tab-bar").getByRole("button", { name: "Storms" }).tap();
    await page.locator("[data-chase-section] [data-updated]").waitFor({ timeout: 15000 });
    const stops = await page.locator("[data-chase-stop]").evaluateAll((nodes) =>
      nodes.slice(0, 5).map((node) => node.innerText.replace(/\s+/g, " ").trim()),
    );
    if (stops.length < 3) throw new Error(`${name} chase list has ${stops.length} stops`);
    const hailLines = stops.map((text) => text.match(/Radar .+?(?= \d[\d,]* vehicles| \d[\d,]* homes|$)/)?.[0] ?? "");
    const countLines = stops.map((text) => text.match(/[\d,]+ (?:vehicles|homes) in path/)?.[0] ?? "");
    if (hailLines.some((line) => !line.includes("Radar")) || new Set(hailLines).size < hailLines.length) {
      throw new Error(`${name} chase rows share hail stats:\n${stops.join("\n")}`);
    }
    if (countLines.some((line) => !line) || new Set(countLines).size < countLines.length) {
      throw new Error(`${name} chase rows share path counts:\n${stops.join("\n")}`);
    }
    await shot(page, `chase-${name}`);
    await page.locator(".tab-bar").getByRole("button", { name: "Map" }).tap();
    await page.locator("[data-honey-open]").tap();
    await page.locator("[data-honey-panel] [data-updated]").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelector("[data-honey-panel]")?.textContent?.includes("Deming"));
    await page.locator(".maplibregl-ctrl-attrib-button").tap();
    await page.locator('.maplibregl-ctrl-attrib[data-credit="open"]').waitFor({ timeout: 5000 });
    const placed = await page.evaluate(() => {
      const panel = document.querySelector("[data-honey-panel]")?.getBoundingClientRect();
      const button = document.querySelector(".maplibregl-ctrl-attrib-button")?.getBoundingClientRect();
      const line = document.querySelector(".maplibregl-ctrl-attrib-inner")?.getBoundingClientRect();
      const lineText = document.querySelector(".maplibregl-ctrl-attrib-inner")?.textContent ?? "";
      return {
        panel: panel && { top: panel.top, right: panel.right, bottom: panel.bottom, left: panel.left },
        button: button && { top: button.top, right: button.right, bottom: button.bottom, left: button.left },
        line: line && { top: line.top, right: line.right, bottom: line.bottom, left: line.left, width: line.width, height: line.height },
        lineText,
      };
    });
    if (!placed.panel || !placed.button || !placed.line) throw new Error(`${name} missing credit or panel boxes`);
    if (!placed.lineText.includes("OpenStreetMap")) throw new Error(`${name} credit line missing: ${placed.lineText}`);
    if (placed.line.width < 8 || placed.line.height < 8) throw new Error(`${name} credit line is clipped`);
    if (overlaps(placed.button, placed.panel) || overlaps(placed.line, placed.panel)) {
      throw new Error(`${name} credit overlaps the panel ${JSON.stringify(placed)}`);
    }
    await page.waitForTimeout(600);
    await shot(page, `money-${name}`);
    await context.close();
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
