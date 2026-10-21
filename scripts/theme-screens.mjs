import { spawnSync } from "node:child_process";
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
  await page.locator("[data-chase-list='ready']").waitFor({ timeout: 20000 });
  await page.getByText("Deming, NM").first().waitFor({ timeout: 20000 });
  if (await page.locator("[data-chase-empty]:visible").count()) throw new Error("chase list is Quiet week");
  await page.waitForTimeout(300);
}

async function pickFortWorthDay(page) {
  await page.getByRole("button", { name: /Hail ·/ }).click();
  await page.getByRole("button", { name: "Pick a day" }).click();
  await page.getByRole("button", { name: /2026/ }).first().click();
  await page.getByRole("option", { name: "2026", exact: true }).click().catch(() => {});
  await page.getByRole("button", { name: "Apr", exact: true }).click();
  await page.getByRole("gridcell", { name: "Apr 25, 2026" }).click();
  await page.waitForTimeout(400);
}

async function openMoney(page) {
  await pickFortWorthDay(page);
  await page.getByRole("button", { name: "Money Hole", exact: true }).click();
  await page.locator("[data-honey-panel]").waitFor({ timeout: 10000 });
  await page.getByText(/Sundance Square|Fort Worth Stockyards/).first().waitFor({ timeout: 30000 });
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
  await page.waitForTimeout(1600);
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
  await openMoney(page);
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

async function captureSplash(browser, palette, scheme, errors) {
  const dir = path.join(root, `theme-${palette}`);
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  watch(page, errors, `${palette}-${scheme}-splash`);
  await page.goto(`${base}/?${query}&theme=${palette}&scheme=${scheme}&splash=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("[data-splash] .swath-name").waitFor({ timeout: 15000 });
  await page.waitForTimeout(250);
  await shot(page, path.join(dir, `${scheme}-splash.png`));
  await context.close();
}

const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const palette of palettes) {
    for (const scheme of schemes) {
      await capturePhone(browser, palette, scheme, errors);
      await captureDesktop(browser, palette, scheme, errors);
      await captureSplash(browser, palette, scheme, errors);
      for (const name of [...phoneShots, "desktop", "splash"]) {
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

const COMPARE_PY = String.raw`
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(sys.argv[1])
names = {
  "map": "Map",
  "chase": "Chase List",
  "money": "Money Holes",
  "storms": "Storms",
  "splash": "Splash",
}
themes = [("a", "Storm Core"), ("b", "Supercell"), ("c", "Ice Swath")]
schemes = [("light", "Light"), ("dark", "Dark")]
font_path = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf"
font = ImageFont.truetype(font_path, 28) if Path(font_path).exists() else ImageFont.load_default()
small = ImageFont.truetype(font_path, 18) if Path(font_path).exists() else font
cell_w, cell_h = 360, 800
pad, head, label_h = 16, 64, 36
cols, rows = 3, 2
width = pad + cols * (cell_w + pad)
height = head + rows * (label_h + cell_h + pad)
for key, title in names.items():
    canvas = Image.new("RGB", (width, height), "#0b1020")
    draw = ImageDraw.Draw(canvas)
    draw.text((pad, 18), title, fill="#f8fbff", font=font)
    for col, (palette, theme_name) in enumerate(themes):
        for row, (scheme, scheme_name) in enumerate(schemes):
            src = root / f"theme-{palette}" / f"{scheme}-{key}.png"
            shot = Image.open(src).convert("RGB")
            shot.thumbnail((cell_w, cell_h), Image.Resampling.LANCZOS)
            x = pad + col * (cell_w + pad)
            y = head + row * (label_h + cell_h + pad)
            draw.text((x, y), f"{theme_name} · {scheme_name}", fill="#dbe7ff", font=small)
            frame = Image.new("RGB", (cell_w, cell_h), "#111827")
            ox = (cell_w - shot.width) // 2
            oy = (cell_h - shot.height) // 2
            frame.paste(shot, (ox, oy))
            canvas.paste(frame, (x, y + label_h))
    canvas.save(root / f"compare-{key}.png")
    print("wrote", root / f"compare-{key}.png")
`;

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "console-errors.txt"), errors.join("\n") || "none");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else if (!process.exitCode) {
  const compared = spawnSync("python3", ["-c", COMPARE_PY, root], { stdio: "inherit" });
  if (compared.status) process.exitCode = compared.status;
  else console.log("theme screens ok", root);
}
