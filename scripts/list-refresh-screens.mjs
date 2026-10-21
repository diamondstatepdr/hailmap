import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.REFRESH_SHOTS ?? "/opt/cursor/artifacts/screens";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const updatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

function stop(id, name, score) {
  return {
    id,
    name,
    date: "2026-10-20",
    lat: 32.75,
    lon: -97.33,
    bounds: { west: -97.6, south: 32.5, east: -97.0, north: 33.0 },
    radarIn: 1.75,
    spotterIn: 1.5,
    vehicles: 840,
    homes: 1200,
    score,
    raw: score,
    level: "High",
    source: "agreed",
    sourceLabel: "Radar and spotter agree",
    density: "measured",
  };
}

const chase = {
  version: 3,
  week: "2026-W43",
  generatedAt: updatedAt,
  windowStart: "2026-10-15",
  windowEnd: "2026-10-21",
  quiet: false,
  partial: false,
  fresh: {
    pdr: [stop("ftw", "Fort Worth, TX", 86), stop("okc", "Oklahoma City, OK", 74), stop("dal", "Dallas, TX", 69)],
    roof: [stop("ftw", "Fort Worth, TX", 86), stop("okc", "Oklahoma City, OK", 74), stop("dal", "Dallas, TX", 69)],
  },
  fallback: { pdr: [], roof: [] },
};

const honey = {
  date: "2026-10-20",
  label: "Oct 20, 2026",
  live: false,
  partial: false,
  status: "complete",
  zoom: false,
  note: null,
  attribution: "Lots and apartments © OpenStreetMap contributors.",
  updatedAt,
  spots: {
    pdr: [
      {
        id: "lot-1",
        name: "Southwest Fort Worth",
        kind: "dealership",
        lat: 32.7,
        lon: -97.4,
        hailIn: 1.75,
        radarIn: 1.75,
        spotterIn: 1.5,
        vehicles: 420,
        homes: null,
        score: 86,
        level: "High",
        distanceKm: 4.2,
        sourceLabel: "Radar and spotter agree",
      },
      {
        id: "lot-2",
        name: "Arlington",
        kind: "parking",
        lat: 32.73,
        lon: -97.11,
        hailIn: 1.25,
        radarIn: 1.25,
        spotterIn: 1,
        vehicles: 180,
        homes: null,
        score: 64,
        level: "High",
        distanceKm: 12,
        sourceLabel: "Radar and spotter agree",
      },
    ],
    roof: [],
  },
  heat: { pdr: { type: "FeatureCollection", features: [] }, roof: { type: "FeatureCollection", features: [] } },
};

async function install(page) {
  await page.route("**/api/chase", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(chase) });
  });
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
  for (const [theme, scheme, name] of themes) {
    const context = await browser.newContext({ ...phone, serviceWorkers: "block" });
    const page = await context.newPage();
    await install(page);
    await page.goto(`${base}/?lat=32.75&lon=-97.33&z=10&day=2026-10-20&theme=${theme}&scheme=${scheme}`, { waitUntil: "domcontentloaded" });
    await page.locator(".maplibregl-map").waitFor({ timeout: 20000 });
    await page.locator(".tab-bar").getByRole("button", { name: "Storms" }).tap();
    await page.locator("[data-chase-section] [data-updated]").waitFor({ timeout: 15000 });
    await shot(page, `chase-${name}`);
    await page.locator(".tab-bar").getByRole("button", { name: "Map" }).tap();
    await page.locator("[data-honey-open]").tap();
    await page.locator("[data-honey-panel] [data-updated]").waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelector("[data-honey-spot]")?.textContent?.includes("Fort Worth"));
    await shot(page, `money-${name}`);
    await context.close();
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
