import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.CANVASS_SHOTS ?? "/opt/cursor/artifacts/canvass";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];
const houses = [
  ["East Main Street, Mesa, AZ", "knocked", "Left a card"],
  ["East Broadway Road, Mesa, AZ", "interested", "Wants a look at the hood"],
  ["West Main Street, Mesa, AZ", "signed", "Roof and hood"],
];

async function hideDev(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
}

async function searchAddress(page, query) {
  const input = page.getByLabel("Search an address");
  await input.click();
  await input.fill("");
  await input.fill(query);
  const choice = page.locator("ul button").filter({ hasText: /Mesa/i }).first();
  await choice.waitFor({ timeout: 20000 });
  await choice.click();
  const form = page.locator("[data-canvass-form]");
  await form.waitFor({ timeout: 25000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.locator("[data-canvass-form]").scrollIntoViewIfNeeded({ timeout: 4000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(400);
    }
  }
}

async function markHouse(page, query, status, note, signIn) {
  await searchAddress(page, query);
  if (signIn) {
    const signInButton = page.getByRole("button", { name: "Sign in to canvass" });
    await signInButton.waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    await signInButton.click();
    await page.getByLabel("Name").fill("Alex");
    await page.getByLabel("Team passcode").fill("team-pass");
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await page.locator(`[data-canvass-status="${status}"]`).waitFor({ timeout: 15000 });
  }
  const statusButton = page.locator(`[data-canvass-status="${status}"]`);
  await statusButton.waitFor({ timeout: 15000 });
  await statusButton.click();
  await page.locator("[data-canvass-form] textarea").fill(note);
  await page.getByRole("button", { name: /Save for the team|Update this house/ }).click();
  await page.getByText(note).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Close" }).click();
  await page.locator("[data-canvass-form]").waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
}

async function shoot(browser, label, options, theme, name) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  const meshReady = page.waitForResponse((response) => response.url().includes("/api/mesh?") && response.ok(), { timeout: 180000 });
  await page.goto(`${base}/?lat=33.415&lon=-111.837&z=13&day=2026-10-20&scheme=light&theme=${theme}`, { waitUntil: "domcontentloaded" });
  await page.locator(".maplibregl-canvas").waitFor({ timeout: 30000 });
  await meshReady;
  await page.waitForTimeout(1200);
  for (let index = 0; index < houses.length; index += 1) {
    const [query, status, note] = houses[index];
    await markHouse(page, query, status, note, index === 0);
  }
  await page.locator(".map-key summary").click();
  await page.locator("[data-canvass-legend]").click();
  await page.getByRole("button", { name: /Main Street/i }).first().click();
  await page.getByRole("dialog", { name: "Canvass" }).getByRole("button", { name: "Close" }).click();
  await page.locator("[data-canvass-card]").waitFor({ timeout: 10000 });
  await page.locator(".map-key").evaluate((el) => el.removeAttribute("open"));
  await page.waitForTimeout(400);
  const file = `${outDir}/${label}-${name}-map.png`;
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
