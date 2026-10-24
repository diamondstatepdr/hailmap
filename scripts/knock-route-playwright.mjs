import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.KNOCK_SHOTS ?? "/opt/cursor/artifacts/knock-route";
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];

async function hideDev(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("swathline-install-dismissed", "1");
    } catch {
      /* private mode */
    }
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
    [0.5, 0.42],
    [0.5, 0.34],
    [0.46, 0.5],
    [0.54, 0.38],
    [0.5, 0.58],
    [0.4, 0.46],
  ];
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) await page.waitForTimeout(2000);
    for (const [fx, fy] of points) {
      const live = await canvas.boundingBox();
      if (!live) continue;
      await canvas.click({ position: { x: live.width * fx, y: live.height * fy }, force: true });
      const button = page.locator("[data-knock-route]");
      try {
        await button.waitFor({ state: "attached", timeout: 2000 });
        await button.scrollIntoViewIfNeeded();
        await button.waitFor({ state: "visible", timeout: 2500 });
        return;
      } catch {
        const close = page.locator(".sheet-dock").getByRole("button", { name: "Close" });
        if (await close.count()) await close.first().click().catch(() => undefined);
      }
    }
  }
  await page.screenshot({ path: `${outDir}/debug-${Date.now()}.png` }).catch(() => undefined);
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
  await page.waitForResponse((response) => response.url().includes("/api/mesh?") && response.ok(), { timeout: 8000 }).catch(() => undefined);
  await page.waitForFunction(() => {
    const zoom = Number(document.querySelector(".maplibregl-map")?.getAttribute("data-map-zoom"));
    return zoom >= 11 && zoom <= 14;
  }, { timeout: 20000 }).catch(() => undefined);
  await page.waitForTimeout(1800);
  await openSwath(page);
  await page.locator("[data-knock-route]").waitFor();
  await page.waitForTimeout(300);
  const card = `${outDir}/${label}-${name}-swath.png`;
  await page.screenshot({ path: card });
  console.log("wrote", card);
  await page.locator("[data-knock-route]").click();
  await page.locator("[data-knock-stop]").first().waitFor({ timeout: 100000 });
  await page.waitForFunction(() => {
    const listed = document.querySelectorAll("[data-knock-stop]").length;
    const pins = document.querySelectorAll(".maplibregl-marker [data-knock-pin]").length;
    return listed > 0 && pins === listed;
  }, { timeout: 15000 });
  await page.waitForTimeout(600);
  const viewport = page.viewportSize();
  const sheetBox = await page.locator("[data-bottom-sheet]").boundingBox();
  const pinBoxes = await page.locator(".maplibregl-marker [data-knock-pin]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height, text: node.textContent?.trim() ?? "" };
    }),
  );
  if (!sheetBox || !viewport) throw new Error("route sheet was not measured");
  const sheetRatio = sheetBox.height / viewport.height;
  if (sheetRatio > 0.52) throw new Error(`route sheet is ${Math.round(sheetRatio * 100)}% of the screen`);
  const hidden = pinBoxes.filter((pin) => pin.y < 70 || pin.y + pin.height > sheetBox.y + 2 || pin.x < 0 || pin.x + pin.width > viewport.width + 1);
  if (hidden.length) throw new Error(`stops outside the map above the sheet: ${JSON.stringify(hidden)}`);
  const listed = await page.locator("[data-knock-stop]").count();
  if (pinBoxes.length !== listed) throw new Error(`map has ${pinBoxes.length} pins and the list has ${listed}`);
  for (let i = 0; i < pinBoxes.length; i += 1) {
    for (let j = i + 1; j < pinBoxes.length; j += 1) {
      const a = pinBoxes[i];
      const b = pinBoxes[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 3 && overlapY > 3) throw new Error(`pins ${a.text} and ${b.text} overlap`);
    }
  }
  const routeLabel = await page.locator("[data-knock-label]").innerText();
  const hails = await page.locator("[data-knock-stop]").evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-hail"))).filter((value) => Number.isFinite(value)),
  );
  const formatInches = (value) => {
    const rounded = Math.round(value * 100) / 100;
    if (Number.isInteger(rounded)) return String(rounded);
    return rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  };
  const low = formatInches(Math.min(...hails));
  const high = formatInches(Math.max(...hails));
  const expectedLabel = low === high ? `${high}" hail` : `${low}–${high}" hail`;
  if (routeLabel !== expectedLabel) throw new Error(`route label is "${routeLabel}", expected "${expectedLabel}"`);
  if (/radar hail/i.test(routeLabel)) throw new Error(`route label still uses the tapped swath: "${routeLabel}"`);
  const noteFit = await page.locator("[data-knock-note]").evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    overflow: node.scrollWidth - node.clientWidth,
  }));
  if (!noteFit || noteFit.height > 22 || noteFit.overflow > 1) throw new Error(`route note is not one line (${JSON.stringify(noteFit)})`);
  const footFit = await page.locator(".knock-foot-note").evaluate((node) => node.scrollWidth - node.clientWidth);
  if (footFit > 1) throw new Error("maps note does not fit on one line");
  const last = page.locator("[data-knock-stop]").last();
  await last.scrollIntoViewIfNeeded();
  const lastBox = await last.boundingBox();
  const foot = await page.locator(".knock-foot").boundingBox();
  if (!lastBox || !foot || lastBox.y + lastBox.height > foot.y - 8) {
    throw new Error(`last stop is under the maps footer ${JSON.stringify({ lastBox, foot })}`);
  }
  await page.locator("[data-knock-sheet] .knock-list").evaluate((node) => {
    node.scrollTop = 0;
  });
  const replay = page.getByRole("button", { name: "Replay" });
  if ((await replay.count()) && (await replay.first().isVisible())) throw new Error("replay card still covers the route map");
  const help = await page.locator("[data-help-open]").boundingBox();
  if (!help || !viewport || help.x < 0 || help.x + help.width > viewport.width + 1) throw new Error("help chip is clipped");
  const route = `${outDir}/${label}-${name}-route.png`;
  await page.screenshot({ path: route });
  console.log("wrote", route);
  await context.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
  const phoneOnly = process.env.PHONE_ONLY === "1";
  const only = process.env.THEME_ONLY;
  for (const [theme, name] of themes) {
    if (only && theme !== only && name !== only) continue;
    await shoot(browser, "phone", phone, theme, name);
    if (!phoneOnly) await shoot(browser, "desktop", desktop, theme, name);
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
