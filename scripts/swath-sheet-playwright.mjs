import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const local = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const beforeBase = process.env.BEFORE_URL ?? "https://hailmap-production.up.railway.app";
const outDir = process.env.SWATH_SHOTS ?? "/opt/cursor/artifacts/swath-sheet";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];
const view = "lat=33.400&lon=-111.830&z=13.2&day=2026-10-20&scheme=light";

async function hideDev(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
}

async function closeChase(page) {
  const dialog = page.getByRole("dialog", { name: /Money Holes/i });
  if (await dialog.count()) {
    const close = dialog.getByRole("button", { name: "Close" });
    if (await close.count()) await close.first().click();
    await page.waitForTimeout(300);
  }
}

async function shoot(browser, label, options, theme, name, base, fileLabel) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  const url = `${base}/?${view}&theme=${theme}`;
  console.log("open", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.waitFor({ timeout: 30000 });
  if (fileLabel !== "before") await page.locator(".map-tool-row").waitFor({ timeout: 20000 });
  await closeChase(page);
  await page.waitForTimeout(fileLabel === "before" ? 5000 : 3500);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no box");
  const spots = [
    [0.39, 0.36],
    [0.42, 0.34],
    [0.36, 0.32],
    [0.48, 0.3],
    [0.33, 0.4],
    [0.5, 0.55],
  ];
  let opened = false;
  for (const [fx, fy] of spots) {
    await canvas.click({ position: { x: box.width * fx, y: box.height * fy }, force: true });
    const stats = page.locator("[data-swath-stats]");
    const hit = await stats.waitFor({ timeout: 1800 }).then(() => true).catch(() => false);
    if (!hit) continue;
    const title = (await page.locator(".sheet-dock h2").first().innerText().catch(() => "")) || "";
    const dealers = page.locator("[data-dealer-open]");
    const legacyDealers = page.locator(".sheet-dock").getByText(/dealership/i);
    if (fileLabel !== "before") {
      await dealers.waitFor({ timeout: 5000 }).catch(() => undefined);
      await page.waitForFunction(() => {
        const node = document.querySelector("[data-dealer-open]");
        const text = node?.textContent ?? "";
        return text.length > 0 && !text.includes("Looking up");
      }, { timeout: 50000 }).catch(() => undefined);
    }
    const dealerText = (await dealers.innerText().catch(() => "")) || (await legacyDealers.innerText().catch(() => "")) || "";
    console.log(label, name, "spot", fx, fy, JSON.stringify(title), JSON.stringify(dealerText.replace(/\s+/g, " ").slice(0, 80)));
    const count = Number((dealerText.match(/(\d+)\s+dealership/) || [])[1] ?? "0");
    const titled = /[12]\.\d+/.test(title) || /swath/i.test(title);
    if (titled && (fileLabel === "before" || count > 0)) {
      opened = true;
      break;
    }
    const close = page.locator(".sheet-dock").getByRole("button", { name: "Close" });
    if (await close.count()) await close.first().click();
    await page.waitForTimeout(250);
  }
  if (!opened) throw new Error(`could not open a 2 inch swath with dealers on ${label} ${name}`);
  if (fileLabel !== "before") {
    await page.locator("[data-dealer-open]").click();
    await page.locator("[data-dealer-hit]").waitFor({ timeout: 8000 });
  }
  await page.waitForTimeout(500);
  const file = `${outDir}/${fileLabel}-${label}-${name}.png`;
  await page.screenshot({ path: file });
  console.log("wrote", file);
  await context.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
  if (process.env.SKIP_BEFORE !== "1") {
    try {
      await shoot(browser, "phone", phone, "a", "storm-core", beforeBase, "before");
    } catch (error) {
      console.error("before shot failed", error);
    }
  }
  for (const [theme, name] of themes) {
    await shoot(browser, "phone", phone, theme, name, local, "after");
    await shoot(browser, "desktop", desktop, theme, name, local, "after");
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
