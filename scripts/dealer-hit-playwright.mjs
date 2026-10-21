import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.HIT_SHOTS ?? "/opt/cursor/artifacts/dealer-hit";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];
const outer = [
  [-97.42, 32.7],
  [-97.24, 32.7],
  [-97.24, 32.82],
  [-97.42, 32.82],
  [-97.42, 32.7],
];
const inner = [
  [-97.34, 32.76],
  [-97.28, 32.76],
  [-97.28, 32.8],
  [-97.34, 32.8],
  [-97.34, 32.76],
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
              properties: { id: "outer", minIn: 1, maxIn: 1, label: "1 in" },
              geometry: { type: "Polygon", coordinates: [outer] },
            },
            {
              type: "Feature",
              properties: { id: "inner", minIn: 2.5, maxIn: 2.5, label: "2.5 in" },
              geometry: { type: "Polygon", coordinates: [inner] },
            },
          ],
        },
      }),
    }),
  );
  await page.route("**/api/dealers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        dealers: [
          {
            id: "west",
            name: "West 7th Motors",
            address: "3500 W 7th St, Fort Worth",
            lat: 32.75,
            lon: -97.33,
            distanceKm: 0.4,
            kind: "dealership",
            phone: "(817) 555-0142",
          },
          {
            id: "north",
            name: "North Loop Honda",
            address: "800 N Loop, Fort Worth",
            lat: 32.78,
            lon: -97.31,
            distanceKm: 2.2,
            kind: "lot",
            phone: "(817) 555-0199",
          },
        ],
        note: "Car dealerships and named auto lots from OpenStreetMap.",
      }),
    }),
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
}

async function shoot(browser, label, options, theme, name) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  await install(page);
  await page.goto(`${base}/?lat=32.75&lon=-97.33&z=12&theme=${theme}`, { waitUntil: "domcontentloaded" });
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor({ timeout: 30000 });
  await page.waitForTimeout(600);
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55);
  await page.locator("[data-dealer-hit]").waitFor({ timeout: 10000 });
  await page.getByText("North Loop Honda").waitFor();
  await page.locator("[data-dealer-hit]").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
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
