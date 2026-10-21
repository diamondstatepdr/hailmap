import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.KNOCK_SHOTS ?? "/opt/cursor/artifacts/knock-route";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];

const ring = [
  [-97.42, 32.7],
  [-97.24, 32.7],
  [-97.24, 32.82],
  [-97.42, 32.82],
  [-97.42, 32.7],
];

const stops = [
  { id: "1", name: "West 7th Street", lat: 32.751, lon: -97.334, hailIn: 1.75 },
  { id: "2", name: "Harley Avenue", lat: 32.756, lon: -97.328, hailIn: 1.5 },
  { id: "3", name: "University Drive", lat: 32.746, lon: -97.322, hailIn: 1.25 },
  { id: "4", name: "Montgomery Street", lat: 32.742, lon: -97.338, hailIn: 1 },
];

async function hideDev(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
}

async function install(page) {
  await page.route("**/api/reports**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reports: [], swaths: { type: "FeatureCollection", features: [] }, fetchedAt: new Date().toISOString(), status: [] }),
    });
  });
  await page.route("**/api/mesh?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        label: "Radar hail",
        note: null,
        collection: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "swath-1",
              properties: { id: "swath-1", minIn: 1.5, maxIn: 1.75, label: "1.5–1.75 in" },
              geometry: { type: "Polygon", coordinates: [ring] },
            },
          ],
        },
      }),
    });
  });
  await page.route("**/api/dealers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ dealers: [], note: "No mapped dealerships in this swath.", attribution: "© OpenStreetMap contributors" }),
    });
  });
  await page.route("**/api/knock-route", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stops,
        note: "Named residential streets from OpenStreetMap. Hardest hail first, then ordered into one route.",
        attribution: "Streets © OpenStreetMap contributors",
      }),
    });
  });
  await page.route("**/api/chase", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 3,
        week: "2026-W16",
        generatedAt: new Date().toISOString(),
        quiet: true,
        partial: false,
        windowStart: "2026-04-13",
        windowEnd: "2026-04-19",
        fresh: { pdr: [], roof: [] },
        fallback: { pdr: [], roof: [] },
      }),
    });
  });
  await page.route("**/api/honey?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        label: "Fort Worth",
        note: null,
        zoom: false,
        updatedAt: new Date().toISOString(),
        attribution: "Lots and apartments © OpenStreetMap contributors.",
        spots: {
          pdr: [
            {
              id: "spot-1",
              name: "West 7th",
              kind: "homes",
              lat: 32.751,
              lon: -97.334,
              hailIn: 1.75,
              radarIn: 1.75,
              spotterIn: null,
              vehicles: 420,
              homes: 180,
              score: 86,
              level: "High",
              distanceKm: null,
              sourceLabel: "Radar 1.75 in",
            },
          ],
          roof: [],
        },
      }),
    });
  });
}

async function openSwath(page) {
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no map");
  const points = [
    [box.x + box.width * 0.5, box.y + box.height * 0.45],
    [box.x + box.width * 0.42, box.y + box.height * 0.5],
    [box.x + box.width * 0.58, box.y + box.height * 0.4],
  ];
  for (const [x, y] of points) {
    await page.mouse.click(x, y);
    const button = page.locator("[data-knock-route]");
    if (await button.count()) {
      try {
        await button.waitFor({ state: "visible", timeout: 2000 });
        return;
      } catch {
        /* try another point */
      }
    }
  }
  throw new Error("swath click did not open the area card");
}

async function shoot(browser, label, options, theme, name) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  await install(page);
  await page.goto(`${base}/?lat=32.75&lon=-97.33&z=12&theme=${theme}`, { waitUntil: "domcontentloaded" });
  const close = page.getByRole("button", { name: "Close" });
  if (await close.count()) {
    await close.first().click().catch(() => undefined);
  }
  await openSwath(page);
  await page.locator("[data-knock-route]").waitFor();
  await page.waitForTimeout(300);
  const card = `${outDir}/${label}-${name}-swath.png`;
  await page.screenshot({ path: card });
  console.log("wrote", card);
  await page.locator("[data-knock-route]").click();
  await page.locator("[data-knock-sheet]").waitFor({ timeout: 15000 });
  await page.getByText("West 7th Street").waitFor();
  await page.waitForTimeout(1200);
  const route = `${outDir}/${label}-${name}-route.png`;
  await page.screenshot({ path: route });
  console.log("wrote", route);
  await context.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
  for (const [theme, name] of themes) {
    await shoot(browser, "phone", phone, theme, name);
    await shoot(browser, "desktop", desktop, theme, name);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
