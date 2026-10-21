import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const root = process.env.SCREEN_ROOT ?? "/cursor/stores/self/screens";
const query = "lat=32.7555&lon=-97.3308&z=11";

const palettes = ["a", "b", "c"];
const schemes = ["light", "dark"];
const phoneShots = ["map", "chase", "storms", "money", "address", "field", "alerts"];

function nav(page) {
  return page.locator("nav[aria-label='Sections']:visible");
}

async function hideBadge(page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
}

async function shot(page, file) {
  await hideBadge(page);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
}

async function openTab(page, label) {
  await nav(page).getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
  await page.waitForTimeout(450);
}

async function closeChase(page) {
  const popup = page.locator("[data-chase-popup]:visible");
  if (!(await popup.count())) return;
  const close = popup.getByRole("button", { name: "Close" }).first();
  if (await close.count()) await close.click();
  await page.waitForTimeout(350);
}

async function openChase(page) {
  await closeChase(page);
  await page.getByRole("button", { name: /Chase List/ }).first().click();
  await page.locator("[data-chase-popup]").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
}

function watch(page, errors, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${tag} ${msg.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${tag} ${error.message}`));
}

async function prepare(page, palette, scheme) {
  await page.goto(`${base}/?${query}&theme=${palette}&scheme=${scheme}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
  await page.waitForFunction(
    ({ palette, scheme }) =>
      document.documentElement.dataset.palette === palette &&
      document.documentElement.classList.contains("dark") === (scheme === "dark"),
    { palette, scheme },
  );
  await page.waitForTimeout(900);
}

async function capturePhone(browser, palette, scheme, errors) {
  const dir = path.join(root, `theme-${palette}`);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    geolocation: { latitude: 32.7555, longitude: -97.3308 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  watch(page, errors, `${palette}-${scheme}`);
  await prepare(page, palette, scheme);

  await closeChase(page);
  await shot(page, path.join(dir, `${scheme}-map.png`));

  await openChase(page);
  await shot(page, path.join(dir, `${scheme}-chase.png`));
  await closeChase(page);

  await openTab(page, "Storms");
  await page.waitForTimeout(600);
  await shot(page, path.join(dir, `${scheme}-storms.png`));

  await openTab(page, "Map");
  await closeChase(page);
  await page.getByRole("button", { name: "Money Hole", exact: true }).click();
  await page.waitForSelector("[data-honey-panel]", { timeout: 10000 });
  await page.waitForTimeout(700);
  await shot(page, path.join(dir, `${scheme}-money.png`));
  await page.getByRole("button", { name: "Close Money Hole" }).click();

  await openTab(page, "Addresses");
  const addressSheet = page.getByRole("dialog", { name: "Addresses" });
  const search = (await addressSheet.count())
    ? addressSheet.getByRole("textbox", { name: "Search an address" })
    : page.getByRole("textbox", { name: "Search an address" });
  await search.fill("3500 W 7th St Fort Worth");
  const suggestion = page.getByRole("button", { name: /fort worth/i }).first();
  await suggestion.waitFor({ timeout: 15000 });
  await suggestion.click();
  await page.getByText(/Damage probability|Could not load|No hail here|Max hail|Checking/).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, path.join(dir, `${scheme}-address.png`));

  await openTab(page, "Field");
  await page.waitForTimeout(800);
  await shot(page, path.join(dir, `${scheme}-field.png`));

  await openTab(page, "Alerts");
  await page.waitForTimeout(400);
  await shot(page, path.join(dir, `${scheme}-alerts.png`));

  await context.close();
  return dir;
}

async function captureDesktop(browser, palette, scheme, errors) {
  const dir = path.join(root, `theme-${palette}`);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    geolocation: { latitude: 32.7555, longitude: -97.3308 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  watch(page, errors, `${palette}-${scheme}-desktop`);
  await prepare(page, palette, scheme);
  await closeChase(page);
  await shot(page, path.join(dir, `${scheme}-desktop.png`));
  await context.close();
}

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const palette of palettes) {
    for (const scheme of schemes) {
      await capturePhone(browser, palette, scheme, errors);
      await captureDesktop(browser, palette, scheme, errors);
      for (const name of [...phoneShots, "desktop"]) {
        const file = path.join(root, `theme-${palette}`, `${scheme}-${name}.png`);
        if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
      }
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "console-errors.txt"), errors.join("\n") || "none");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("theme screens ok", root);
}
