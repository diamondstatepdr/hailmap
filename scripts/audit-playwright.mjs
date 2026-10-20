import fs from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const out = process.env.SHOT_DIR ?? "/opt/cursor/artifacts/audit/after";
fs.mkdirSync(out, { recursive: true });

const consoleErrors = [];

function nav(page) {
  return page.locator("nav[aria-label='Sections']:visible");
}

async function hideBadge(page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
}

async function shot(page, name) {
  await hideBadge(page);
  await page.screenshot({ path: `${out}/${name}.png` });
}

async function openTab(page, label) {
  await nav(page).getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await page.waitForTimeout(400);
}

async function pickFortWorthDay(page) {
  await page.getByRole("button", { name: /Hail ·/ }).click();
  await page.getByRole("button", { name: "Pick a day" }).click();
  const title = page.getByRole("button", { name: /2026/ }).first();
  await title.click();
  await page.getByRole("option", { name: "2026", exact: true }).click().catch(() => {});
  await page.getByRole("button", { name: "Apr", exact: true }).click();
  await page.getByRole("gridcell", { name: "Apr 25, 2026" }).click();
}

async function runViewport(browser, { width, height, hasTouch, prefix }) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch,
    isMobile: hasTouch,
    deviceScaleFactor: hasTouch ? 2 : 1,
    geolocation: { latitude: 32.7555, longitude: -97.3308 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${prefix} ${msg.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${prefix} ${error.message}`));

  await page.goto(`${base}/?lat=32.7555&lon=-97.3308&z=11`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, `${prefix}-01-map`);

  await page.getByRole("button", { name: /Hail ·/ }).click();
  await page.waitForTimeout(300);
  await shot(page, `${prefix}-03-hazards-time`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const rangeGone = await page.locator("#storm-range").count();
  if (rangeGone) throw new Error(`${prefix} Escape left the range sheet open`);

  await page.getByRole("button", { name: "Filters" }).click();
  await page.waitForTimeout(400);
  await shot(page, `${prefix}-05-filters`);
  await page.getByRole("button", { name: "Done" }).click();

  await openTab(page, "Storms");
  await page.waitForTimeout(800);
  await shot(page, `${prefix}-02-storms`);

  await openTab(page, "Map");
  await pickFortWorthDay(page);
  await page.waitForTimeout(500);
  await shot(page, `${prefix}-08-calendar-day`);
  await page.getByRole("button", { name: /Replay/ }).first().click();
  await page.waitForTimeout(1500);
  await shot(page, `${prefix}-replay`);
  await page.getByRole("button", { name: "Close replay" }).click();
  await page.waitForTimeout(400);

  const honeyStart = Date.now();
  await page.getByRole("button", { name: "Money Hole", exact: true }).click();
  await page.waitForSelector("[data-honey-panel]", { timeout: 10000 });
  await shot(page, `${prefix}-07-money-loading`);
  await page
    .waitForFunction(() => {
      const panel = document.querySelector("[data-honey-panel]");
      return panel && panel.getAttribute("data-honey-status") !== "loading";
    }, { timeout: 90000 })
    .catch(() => {});
  const honeyMs = Date.now() - honeyStart;
  fs.appendFileSync(`${out}/timings.txt`, `${prefix} money-hole-ui ${honeyMs}\n`);
  await shot(page, `${prefix}-07-money-holes`);
  await page.getByRole("button", { name: "Close Money Hole" }).click();

  await openTab(page, "Addresses");
  await shot(page, `${prefix}-06-addresses-empty`);
  const search = page.getByRole("textbox", { name: "Search an address" });
  await search.fill("3500 W 7th St Fort Worth");
  const suggestion = page.getByRole("button", { name: /fort worth/i }).first();
  await suggestion.waitFor({ timeout: 15000 });
  await suggestion.click();
  await page.getByText(/Damage probability|Could not load|No hail here|Max hail|Checking/).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, `${prefix}-01-addresses`);

  await openTab(page, "Field");
  await page.waitForTimeout(4000);
  await shot(page, `${prefix}-04-field`);

  await openTab(page, "Reports");
  await page.waitForTimeout(300);
  await shot(page, `${prefix}-10-reports`);

  await openTab(page, "Alerts");
  await page.waitForTimeout(400);
  await shot(page, `${prefix}-09-alerts`);

  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await runViewport(browser, { width: 412, height: 915, hasTouch: true, prefix: "m" });
  await runViewport(browser, { width: 1280, height: 800, hasTouch: false, prefix: "d" });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

fs.writeFileSync(`${out}/console-errors.txt`, consoleErrors.join("\n") || "none");
if (consoleErrors.length) {
  console.error(consoleErrors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("playwright ok", out);
}
