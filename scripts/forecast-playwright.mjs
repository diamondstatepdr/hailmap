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
  await page.goto(`${base}/?lat=33.50&lon=-111.73&z=11&day=2026-10-20&scheme=light&theme=${theme}`, { waitUntil: "domcontentloaded" });
  await meshReady;
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor({ timeout: 30000 });
  await page.locator("[data-radar-label]").filter({ hasText: "Oct 20" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas missing");
  const open = page.locator("[data-forecast-open]").last();
  const spots = [
    [0.5, 0.58],
    [0.42, 0.66],
    [0.62, 0.5],
    [0.35, 0.72],
    [0.7, 0.62],
    [0.48, 0.5],
    [0.55, 0.42],
    [0.38, 0.48],
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
