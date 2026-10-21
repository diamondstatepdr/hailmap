import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const root = process.env.SCREEN_ROOT ?? "/cursor/stores/self/screens/picker";
const query = "lat=32.7555&lon=-97.3308&z=10.5";

const hailCheck = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
hits = 0
for y in range(int(h * 0.28), int(h * 0.86), 2):
    for x in range(int(w * 0.08), int(w * 0.92), 2):
        r, g, b = im.getpixel((x, y))
        orange = r > 180 and 40 < g < 145 and b < 80 and r > g + 45
        red = r > 170 and g < 90 and b < 90 and r > b + 70
        green = 60 < r < 150 and g > 120 and b < 80 and g > r + 15
        if orange or red or green:
            hits += 1
print("hail" if hits > 350 else f"miss {hits}")
`;

async function hideBadge(page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
}

function watch(page, errors, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${tag} ${msg.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${tag} ${error.message}`));
}

async function closeChase(page) {
  const popup = page.locator("[data-chase-popup]:visible");
  if (!(await popup.count())) return;
  const close = popup.getByRole("button", { name: "Close" }).first();
  if (await close.count()) await close.click();
  await page.waitForTimeout(250);
}

async function assertInside(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`missing box for ${selector}`);
  if (box.x < -1 || box.y < -1 || box.x + box.width > vp.width + 1 || box.y + box.height > vp.height + 1) {
    throw new Error(`${selector} overflows ${JSON.stringify(box)} in ${vp.width}x${vp.height}`);
  }
  const close = await page.getByRole("button", { name: "Close", exact: true }).boundingBox();
  if (!close) throw new Error("picker close is not visible");
}

async function exercisePicker(page) {
  await page.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await page.locator("[data-theme-picker]").waitFor();
  await assertInside(page, "[data-theme-picker]");
  await page.getByRole("radio", { name: /Supercell/ }).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === "b");
  const stored = await page.evaluate(() => localStorage.getItem("swathline-palette"));
  if (stored !== "b") throw new Error(`expected stored palette b, got ${stored}`);
  await page.getByRole("radio", { name: /Ice Swath/ }).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === "c");
  await page.getByRole("radio", { name: /Storm Core/ }).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === "a");
}

async function capturePicker(browser, scheme, errors) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    geolocation: { latitude: 32.7555, longitude: -97.3308 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  watch(page, errors, `picker-${scheme}`);
  await page.goto(`${base}/?${query}&theme=a&scheme=${scheme}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
  await closeChase(page);
  await exercisePicker(page);
  await hideBadge(page);
  await page.screenshot({ path: path.join(root, `picker-${scheme}.png`) });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("[data-theme-picker]").waitFor({ state: "hidden" });
  await context.close();
}

async function capturePickerDesktop(browser, errors) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    geolocation: { latitude: 32.7555, longitude: -97.3308 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  watch(page, errors, "picker-desktop");
  await page.goto(`${base}/?${query}&theme=a&scheme=light`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
  await closeChase(page);
  await page.getByRole("button", { name: "Appearance", exact: true }).first().click();
  await page.locator("[data-theme-picker]").waitFor();
  await assertInside(page, "[data-theme-picker]");
  await page.getByRole("radio", { name: /Ice Swath/ }).click();
  await page.waitForFunction(() => document.documentElement.dataset.palette === "c");
  await context.close();
}

async function captureSwath(browser, palette, errors) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    geolocation: { latitude: 32.7555, longitude: -97.3308 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  watch(page, errors, `swath-${palette}`);
  await page.goto(`${base}/?${query}&day=2026-04-25&theme=${palette}&scheme=dark`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
  await page.locator("[data-radar-label]").waitFor({ timeout: 20000 });
  await closeChase(page);
  const file = path.join(root, `swath-${palette}.png`);
  let found = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(1200);
    await hideBadge(page);
    await page.screenshot({ path: file });
    const check = spawnSync("python3", ["-c", hailCheck, file], { encoding: "utf8" });
    if (check.stdout.includes("hail")) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Fort Worth hail swath not visible for theme ${palette}`);
  await context.close();
}

fs.mkdirSync(root, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const scheme of ["light", "dark"]) await capturePicker(browser, scheme, errors);
  await capturePickerDesktop(browser, errors);
  for (const palette of ["a", "b", "c"]) await captureSwath(browser, palette, errors);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/?theme=b`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.palette === "b" && localStorage.getItem("swathline-palette") === "b");
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.palette === "b");
  await context.close();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

fs.writeFileSync(path.join(root, "console-errors.txt"), errors.join("\n") || "none");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("picker screens ok", root);
}
