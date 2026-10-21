import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const root = process.env.SCREEN_ROOT ?? "/cursor/stores/self/screens/picker2";
const query = "lat=32.7555&lon=-97.3308&z=10.5&day=2026-04-25";

const hailCheck = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
hits = 0
chroma = 0
counted = 0
warm = 0
for y in range(int(h * 0.32), int(h * 0.80), 2):
    for x in range(int(w * 0.08), int(w * 0.92), 2):
        r, g, b = im.getpixel((x, y))
        orange = r > 180 and 40 < g < 145 and b < 80 and r > g + 45
        red = r > 170 and g < 90 and b < 90 and r > b + 70
        green = 60 < r < 150 and g > 120 and b < 80 and g > r + 15
        if orange or red or green:
            hits += 1
            continue
        if max(r, g, b) < 48:
            chroma += max(r, g, b) - min(r, g, b)
            counted += 1
            if max(r, g, b) - min(r, g, b) < 16:
                warm += 1
mean = chroma / counted if counted else 999
print(f"hail {hits} dark {counted} neutral {warm} darkchroma {mean:.1f}")
`;

function boxesOverlap(a, b) {
  if (!a || !b) return true;
  return !(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1);
}

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

async function assertCredit(page) {
  const legend = await page.locator(".map-legend").boundingBox();
  const attrib = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
  const vp = page.viewportSize();
  if (!legend || !attrib || !vp) throw new Error(`legend or attribution missing ${JSON.stringify({ legend, attrib })}`);
  if (boxesOverlap(legend, attrib)) throw new Error(`legend overlaps attribution ${JSON.stringify({ legend, attrib })}`);
  for (const [name, box] of [["legend", legend], ["attribution", attrib]]) {
    if (box.x < -1 || box.y < -1 || box.x + box.width > vp.width + 1 || box.y + box.height > vp.height + 1) {
      throw new Error(`${name} outside viewport ${JSON.stringify(box)} ${vp.width}x${vp.height}`);
    }
  }
  if (attrib.width < 40 || attrib.height < 40) throw new Error(`attribution button is too small ${JSON.stringify(attrib)}`);
  const tucked = await page.locator(".maplibregl-ctrl-attrib").getAttribute("data-tucked");
  if (tucked !== "1") throw new Error("attribution was not tucked into the info button");
  const shown = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => getComputedStyle(el).display !== "none");
  if (shown) throw new Error("attribution text is showing over the map");
}

async function capture(browser, palette, scheme, errors, viewport) {
  const context = await browser.newContext({
    viewport,
    hasTouch: viewport.width < 700,
    isMobile: viewport.width < 700,
    deviceScaleFactor: viewport.width < 700 ? 2 : 1,
    geolocation: { latitude: 32.7555, longitude: -97.3308 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  const tag = `swath-${palette}-${scheme}-${viewport.width}`;
  watch(page, errors, tag);
  await page.goto(`${base}/?${query}&theme=${palette}&scheme=${scheme}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
  await page.locator("[data-radar-label]").waitFor({ timeout: 20000 });
  await closeChase(page);
  await page.waitForFunction(() => document.querySelector(".maplibregl-ctrl-attrib")?.getAttribute("data-tucked") === "1");
  await assertCredit(page);
  if (viewport.width >= 700) {
    await page.locator(".maplibregl-ctrl-attrib-button").click();
    await page.waitForFunction(() => {
      const inner = document.querySelector(".maplibregl-ctrl-attrib-inner");
      return Boolean(inner && getComputedStyle(inner).display !== "none");
    });
    const credit = await page.locator(".maplibregl-ctrl-attrib-inner").boundingBox();
    const creditText = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => el.textContent ?? "");
    const vp = page.viewportSize();
    if (!creditText.includes("OpenStreetMap")) throw new Error(`credit missing OpenStreetMap: ${creditText}`);
    if (!credit || !vp || credit.x < -1 || credit.y < -1 || credit.x + credit.width > vp.width + 1 || credit.y + credit.height > vp.height + 1) {
      throw new Error(`desktop credit clipped ${JSON.stringify(credit)}: ${creditText}`);
    }
    const legend = await page.locator(".map-legend").boundingBox();
    if (boxesOverlap(legend, credit)) throw new Error(`desktop credit overlaps legend ${JSON.stringify({ legend, credit })}`);
    await context.close();
    return "layout";
  }
  const file = path.join(root, `swath-${palette}-${scheme}.png`);
  let stats = "";
  let found = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(1200);
    await hideBadge(page);
    await page.screenshot({ path: file });
    const check = spawnSync("python3", ["-c", hailCheck, file], { encoding: "utf8" });
    stats = (check.stdout || "").trim();
    if (Number(stats.match(/hail (\d+)/)?.[1] ?? 0) > 350) {
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`Fort Worth hail swath not visible for ${palette} ${scheme}: ${stats}`);
  if (palette === "b" && scheme === "dark") {
    const neutral = Number(stats.match(/neutral (\d+)/)?.[1] ?? 0);
    const mean = Number(stats.match(/darkchroma ([\d.]+)/)?.[1] ?? 999);
    if (neutral < 400 || mean > 24) throw new Error(`Supercell basemap is not charcoal: ${stats}`);
  }
  await page.locator(".maplibregl-ctrl-attrib-button").click();
  await page.waitForFunction(() => {
    const inner = document.querySelector(".maplibregl-ctrl-attrib-inner");
    return Boolean(inner && getComputedStyle(inner).display !== "none");
  });
  const credit = await page.locator(".maplibregl-ctrl-attrib-inner").boundingBox();
  const creditText = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => el.textContent ?? "");
  const vp = page.viewportSize();
  if (!creditText.includes("OpenStreetMap")) throw new Error(`credit missing OpenStreetMap: ${creditText}`);
  if (!credit || !vp || credit.x < -1 || credit.y < -1 || credit.x + credit.width > vp.width + 1 || credit.y + credit.height > vp.height + 1) {
    throw new Error(`credit clipped ${JSON.stringify(credit)} in ${vp?.width}x${vp?.height}: ${creditText}`);
  }
  const legend = await page.locator(".map-legend").boundingBox();
  if (boxesOverlap(legend, credit)) throw new Error(`open credit overlaps legend ${JSON.stringify({ legend, credit })}`);
  const overflows = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2);
  if (overflows) throw new Error(`credit text is cut off: ${creditText}`);
  await context.close();
  return stats;
}

fs.mkdirSync(root, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const phone = { width: 412, height: 915 };
const desktop = { width: 1280, height: 800 };
try {
  for (const scheme of ["dark", "light"]) {
    for (const palette of ["a", "b", "c"]) {
      const stats = await capture(browser, palette, scheme, errors, phone);
      console.log(`phone ${palette} ${scheme} ${stats}`);
      await capture(browser, palette, scheme, errors, desktop);
      console.log(`desktop ${palette} ${scheme} ok`);
    }
  }
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
  console.log("picker2 screens ok", root);
}
