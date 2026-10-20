import fs from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const out = process.env.SHOT_DIR ?? "/opt/cursor/artifacts/audit/before";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 412, height: 915 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  geolocation: { latitude: 32.7555, longitude: -97.3308 },
  permissions: ["geolocation"],
});
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
const shot = async (name) => {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.screenshot({ path: `${out}/${name}.png` });
};
const click = async (name) => {
  const button = page.getByRole("button", { name }).first();
  if (await button.count()) await button.click({ timeout: 4000 }).catch(() => {});
};

await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(2500);
await shot("08-initial-map");
await page.goto(base + "/?lat=32.7555&lon=-97.3308&z=11", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await shot("08-deeplink");
await click(/Filters/);
await page.waitForTimeout(500);
await shot("05-filters");
await page.keyboard.press("Escape").catch(() => {});
await click(/^Storms/);
await page.waitForTimeout(1200);
await shot("02-storms");
await click(/^Map/);
await page.waitForTimeout(800);
await shot("03-stacked-chips");
await click(/Money holes|Money Hole/i);
await page.waitForTimeout(1500);
await shot("07-money-holes");
await page.keyboard.press("Escape").catch(() => {});
await click(/^Addresses/);
await page.waitForTimeout(400);
await shot("06-km-chips");
const box = page.getByRole("textbox").first();
if (await box.count()) {
  await box.fill("3500 W 7th St Fort Worth");
  await page.waitForTimeout(2000);
  const hit = page.getByRole("button", { name: /fort worth/i }).first();
  if (await hit.count()) await hit.click().catch(() => {});
  await page.waitForTimeout(1500);
}
await shot("01-addresses");
await click(/^Field/);
await page.waitForTimeout(3500);
await shot("04-field");
await click(/^Reports/);
await page.waitForTimeout(400);
await shot("10-reports");
await click(/^Alerts/);
await page.waitForTimeout(400);
await shot("09-alerts");
await browser.close();
console.log("before shots", out);
