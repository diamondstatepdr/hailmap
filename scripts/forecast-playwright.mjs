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

async function hideDev(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
}

async function shoot(browser, label, options, theme, name) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  const meshReady = page.waitForResponse((response) => response.url().includes("/api/mesh") && response.ok(), { timeout: 60000 });
  await page.goto(`${base}/?lat=33.389&lon=-111.830&z=12.8&day=2026-10-20&scheme=light&theme=${theme}`, { waitUntil: "domcontentloaded" });
  await meshReady;
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor({ timeout: 30000 });
  await page.locator("[data-radar-label]").filter({ hasText: "Oct 20" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas missing");
  const open = page.locator("[data-forecast-open]").last();
  const spots = [
    [0.5, 0.34],
    [0.4, 0.34],
    [0.5, 0.64],
    [0.5, 0.5],
    [0.42, 0.46],
    [0.62, 0.5],
  ];
  let opened = false;
  for (const [px, py] of spots) {
    await canvas.click({ position: { x: box.width * px, y: box.height * py }, force: true });
    try {
      await open.waitFor({ timeout: 2000 });
    } catch {
      const close = page.locator("[data-bottom-sheet] button[aria-label='Close']");
      if (await close.count()) await close.first().click();
      continue;
    }
    await open.click();
    await page.locator("[data-forecast-guide]").waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () => {
        const root = document.querySelector("[data-forecast]");
        return Boolean(root && !root.textContent?.includes("Counting Census"));
      },
      { timeout: 90000 },
    );
    const text = (await page.locator("[data-forecast]").innerText()).replace(/\s+/g, " ");
    if (text.includes("~$")) {
      opened = true;
      break;
    }
    const close = page.locator("[data-bottom-sheet] button[aria-label='Close']");
    if (await close.count()) await close.first().click();
  }
  if (!opened) throw new Error("no swath produced a dollar estimate");
  const help = page.locator("[data-help-open]");
  const helpBox = await help.boundingBox();
  const viewport = page.viewportSize();
  if (!helpBox || !viewport || helpBox.x < 0 || helpBox.x + helpBox.width > viewport.width + 1) {
    throw new Error("help chip is clipped by the viewport");
  }
  const band = page.locator("[data-forecast] li").filter({ hasText: /1\.5/ }).first();
  if (await band.count()) {
    await band.evaluate((el) => el.scrollIntoView({ block: "center" }));
  }
  await page.waitForTimeout(400);
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
