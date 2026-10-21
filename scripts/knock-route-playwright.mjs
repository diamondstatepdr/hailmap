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
  await page.route("**/api/dealers", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ dealers: [], note: "No mapped dealerships in this swath.", attribution: "© OpenStreetMap contributors" }),
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
  const holes = page.getByRole("dialog", { name: /Money Holes/i });
  if (await holes.count()) {
    const close = holes.getByRole("button", { name: "Close" });
    if (await close.count()) await close.first().click();
  }
  await page.waitForTimeout(1500);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no map");
  const points = [
    [0.5, 0.34],
    [0.5, 0.5],
    [0.4, 0.34],
    [0.5, 0.64],
    [0.42, 0.46],
  ];
  for (const [fx, fy] of points) {
    await canvas.click({ position: { x: box.width * fx, y: box.height * fy }, force: true });
    const button = page.locator("[data-knock-route]");
    try {
      await button.waitFor({ state: "attached", timeout: 2500 });
      await button.scrollIntoViewIfNeeded();
      await button.waitFor({ state: "visible", timeout: 3000 });
      return;
    } catch {
      const close = page.locator(".sheet-dock").getByRole("button", { name: "Close" });
      if (await close.count()) await close.first().click();
    }
  }
  throw new Error("swath click did not open the area card");
}

async function shoot(browser, label, options, theme, name) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  await install(page);
  const meshReady = page.waitForResponse((response) => response.url().includes("/api/mesh?") && response.ok(), { timeout: 180000 });
  await page.goto(`${base}/?lat=33.389&lon=-111.830&z=12.8&day=2026-10-20&scheme=light&theme=${theme}`, { waitUntil: "domcontentloaded" });
  await meshReady;
  await openSwath(page);
  await page.locator("[data-knock-route]").waitFor();
  await page.waitForTimeout(300);
  const card = `${outDir}/${label}-${name}-swath.png`;
  await page.screenshot({ path: card });
  console.log("wrote", card);
  await page.locator("[data-knock-route]").click();
  await page.locator("[data-knock-sheet] .knock-list li").first().waitFor({ timeout: 100000 });
  await page.waitForTimeout(2800);
  const replay = page.getByRole("button", { name: "Replay" });
  if ((await replay.count()) && (await replay.first().isVisible())) throw new Error("replay card still covers the route map");
  const help = await page.locator("[data-help-open]").boundingBox();
  const viewport = page.viewportSize();
  if (!help || !viewport || help.x < 0 || help.x + help.width > viewport.width + 1) throw new Error("help chip is clipped");
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
