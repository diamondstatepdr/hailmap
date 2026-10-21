import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.FORECAST_SHOTS ?? "/opt/cursor/artifacts/forecast";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];
const ring = [
  [-97.36, 32.72],
  [-97.3, 32.72],
  [-97.3, 32.78],
  [-97.36, 32.78],
  [-97.36, 32.72],
];

async function hideDev(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
}

async function install(page) {
  await page.route("**/api/reports**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reports: [], swaths: { type: "FeatureCollection", features: [] }, fetchedAt: new Date().toISOString(), status: [] }),
    }),
  );
  await page.route("**/api/mesh?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        label: "Radar hail",
        collection: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { id: "band", minIn: 1.75, maxIn: 1.75, label: "1.75 in" },
              geometry: { type: "Polygon", coordinates: [ring] },
            },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/dealers", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ dealers: [], note: "None" }) }),
  );
  await page.route("**/api/chase", (route) =>
    route.fulfill({
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
    }),
  );
  await page.route("**/api/forecast/prices", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ prices: { pdrLow: 175, pdrHigh: 450, roofLow: 6500, roofHigh: 14000 }, estimate: true }),
    }),
  );
}

async function shoot(browser, label, options, theme, name) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  await install(page);
  await page.goto(`${base}/?lat=32.75&lon=-97.33&z=13&theme=${theme}`, { waitUntil: "domcontentloaded" });
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  const open = page.locator("[data-forecast-open]").last();
  await open.waitFor({ timeout: 10000 });
  await open.click();
  await page.locator("[data-forecast]").waitFor();
  await page.getByText("Price settings").waitFor();
  await page.locator("[data-forecast]").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(250);
  const file = `${outDir}/${label}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("wrote", file);
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
