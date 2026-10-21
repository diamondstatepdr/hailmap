import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.LEAD_SHOTS ?? "/opt/cursor/artifacts/leads";
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

async function install(page) {
  await page.route("**/api/reports**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reports: [], swaths: { type: "FeatureCollection", features: [] }, fetchedAt: new Date().toISOString(), status: [] }),
    }),
  );
  await page.route("**/api/chase", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 3,
        week: "2026-W16",
        generatedAt: new Date().toISOString(),
        quiet: true,
        partial: false,
        windowStart: "2026-04-13",
        windowEnd: "2026-04-19",
        fresh: { pdr: [], roof: [] },
        fallback: { pdr: [], roof: [] },
      }),
    }),
  );
  await page.route("**/api/leads", async (route) => {
    if (route.request().url().includes("format=")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        leads: [
          {
            address: "East Main Street, Mesa, AZ",
            status: "interested",
            rep: "Alex",
            note: "Hood and roof, call tonight",
            date: "2026-10-20",
            hailIn: 2,
          },
          {
            address: "East Broadway Road, Mesa, AZ",
            status: "signed",
            rep: "Jordan",
            note: "Roof and hood",
            date: "2026-10-20",
            hailIn: 1.5,
          },
          {
            address: "West Main Street, Mesa, AZ",
            status: "interested",
            rep: "Sam",
            note: "Left a card",
            date: "2026-10-20",
            hailIn: 1,
          },
        ],
      }),
    });
  });
}

async function shoot(browser, label, options, theme, name) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  await install(page);
  await page.goto(`${base}/?lat=33.415&lon=-111.837&day=2026-10-20&scheme=light&theme=${theme}`, { waitUntil: "domcontentloaded" });
  await page.locator(".maplibregl-canvas").waitFor({ timeout: 20000 });
  const reports = page.getByRole("button", { name: /^Reports/ });
  await reports.waitFor({ timeout: 20000 });
  await reports.click();
  await page.getByRole("button", { name: "Sign in to export" }).click();
  await page.getByLabel("Name").fill("Alex");
  await page.getByLabel("Team passcode").fill("team-pass");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await page.locator("[data-leads]").getByText("East Main Street, Mesa, AZ").waitFor({ timeout: 10000 });
  await page.locator("[data-leads-sheets]").waitFor();
  await page.locator(".page-enter[data-tone='reports']").evaluate((el) => {
    el.scrollTop = 0;
    el.parentElement?.scrollTo?.({ top: 0 });
  });
  await page.waitForTimeout(300);
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
