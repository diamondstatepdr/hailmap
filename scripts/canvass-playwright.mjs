import fs from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const out = process.env.SHOT_DIR ?? "/opt/cursor/artifacts/canvass";
fs.mkdirSync(out, { recursive: true });

const themes = [
  { id: "a", name: "storm-core" },
  { id: "b", name: "supercell" },
  { id: "c", name: "ice-swath" },
];

const houses = [
  ["4100 W 7th St, Fort Worth", 32.7518, -97.3345, "knocked", "Left a card"],
  ["4200 W 7th St, Fort Worth", 32.7526, -97.3322, "not_home", ""],
  ["3900 W 7th St, Fort Worth", 32.7504, -97.3368, "interested", "Wants a roof quote"],
  ["4000 W 7th St, Fort Worth", 32.7534, -97.3298, "signed", "Signed today"],
];

async function hideBadge(page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
}

async function shot(page, name) {
  await hideBadge(page);
  await page.screenshot({ path: `${out}/${name}.png` });
}

async function signIn(page) {
  const canvassSignIn = page.getByRole("button", { name: "Sign in to canvass" });
  if (await canvassSignIn.count()) {
    await canvassSignIn.first().click();
  } else {
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  }
  const dialog = page.getByRole("heading", { name: "Sign in" });
  await dialog.waitFor({ timeout: 8000 });
  await page.getByLabel("Name").fill("Alex");
  await page.getByLabel("Team passcode").fill(process.env.HAILMAP_TEAM_PASSCODE ?? "team-pass");
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("[data-canvass-form] [data-canvass-status='knocked']").waitFor({ timeout: 8000 });
}

async function seed(page) {
  await page.evaluate(async (rows) => {
    for (const [address, lat, lon, status, note] of rows) {
      const response = await fetch("/api/canvass", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, lat, lon, status, note, hailIn: 1.75 }),
      });
      if (!response.ok) throw new Error(await response.text());
    }
  }, houses);
}

async function runViewport(browser, { width, height, hasTouch, prefix }) {
  for (const theme of themes) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch,
      isMobile: hasTouch,
      deviceScaleFactor: hasTouch ? 2 : 1,
    });
    const page = await context.newPage();
    await page.goto(`${base}/?theme=${theme.id}&lat=32.7518&lon=-97.333&z=15`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
    await page.waitForTimeout(800);
    const nav = page.locator("nav[aria-label='Sections']:visible");
    await nav.getByRole("button", { name: /^Field\b/ }).click();
    await page.waitForTimeout(500);
    await signIn(page);
    await seed(page);
    const form = page.locator("[data-canvass-form]").first();
    await form.locator("[data-canvass-status='knocked']").click();
    await form.getByPlaceholder("Optional").fill("Owner asked us to come back");
    await form.getByRole("button", { name: /Save for the team|Update this house/ }).click();
    await form.locator("[data-canvass-counts]").getByText("Alex").waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    await shot(page, `${prefix}-${theme.name}-field`);

    await nav.getByRole("button", { name: /^Map\b/ }).click();
    await page.locator("[data-canvass-legend]").waitFor({ timeout: 12000 });
    await page.waitForTimeout(600);
    await shot(page, `${prefix}-${theme.name}-map`);
    await page.locator("[data-canvass-legend]").click();
    await page.getByText("Team canvass").waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    await shot(page, `${prefix}-${theme.name}-board`);
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await runViewport(browser, { width: 412, height: 915, hasTouch: true, prefix: "phone" });
  await runViewport(browser, { width: 1280, height: 800, hasTouch: false, prefix: "desktop" });
  console.log("canvass screenshots", out);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
