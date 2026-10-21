import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.PROOF_SHOTS ?? "/opt/cursor/artifacts/hail-proof";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const desktop = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];

const draft = {
  address: "3500 W 7th St, Fort Worth",
  lat: 32.75,
  lon: -97.33,
  maxHailIn: 1.75,
  score: 64,
  level: "High",
  summary: "1.75 in hail on Apr 25 sits inside a radar swath over this block. Treat the score as an estimate.",
  storms: [{ date: "2026-04-25", label: "Apr 25, 2026", hailIn: 1.75 }],
  nearby: [
    { when: "Apr 25, 4:12 PM", where: "Fort Worth", detail: "1.75 in hail" },
    { when: "Apr 25, 4:40 PM", where: "2.1 mi east", detail: "1.00 in hail" },
  ],
  rings: [
    [
      [-97.4, 32.7],
      [-97.25, 32.7],
      [-97.25, 32.8],
      [-97.4, 32.8],
      [-97.4, 32.7],
    ],
  ],
};

function placePayload(lat, lon) {
  return {
    lat,
    lon,
    radiusKm: 8,
    hours: 168,
    reports: [],
    maxHailIn: 1.75,
    maxWindMph: null,
    strongestTornado: null,
    nearestKm: 1.2,
    swathHit: true,
    swathMaxSizeIn: 1.75,
    warnings: [],
    warningStatus: "ok",
    score: {
      score: 64,
      level: "High",
      summary: "1.75 in hail sits on this stop.",
      factors: [{ id: "size", label: "Hail size", points: 40, detail: "1.75 in within this stop" }],
    },
  };
}

async function hideDev(page) {
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.documentElement.appendChild(style);
  });
}

async function shootProof(browser, id) {
  for (const [theme, name] of themes) {
    for (const [label, options] of [
      ["phone", phone],
      ["desktop", desktop],
    ]) {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      await hideDev(page);
      await page.goto(`${base}/proof/${id}?theme=${theme}`, { waitUntil: "networkidle" });
      await page.locator("[data-hail-proof-page]").waitFor();
      await page.locator("h2", { hasText: "3500 W 7th St" }).waitFor();
      const file = `${outDir}/${label}-${name}-proof.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log("wrote", file);
      await context.close();
    }
  }
}

async function shootField(browser) {
  for (const [theme, name] of themes) {
    for (const [label, options] of [
      ["phone", phone],
      ["desktop", desktop],
    ]) {
      const context = await browser.newContext({ ...options, serviceWorkers: "block" });
      const page = await context.newPage();
      await hideDev(page);
      await page.route("**/api/geocode?**", async (route) => {
        const url = new URL(route.request().url());
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon"));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ lat, lon, street: "W 7th St, Fort Worth", streetStatus: "ok" }),
        });
      });
      await page.route("**/api/place?**", async (route) => {
        const url = new URL(route.request().url());
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon"));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(placePayload(lat, lon)),
        });
      });
      await page.goto(`${base}/?lat=32.75&lon=-97.33&z=11&theme=${theme}`, { waitUntil: "domcontentloaded" });
      await page.locator(".maplibregl-canvas").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: /^Field/ }).click();
      await page.locator("[data-field-street]").waitFor({ timeout: 15000 });
      await page.waitForFunction(() => document.querySelector("[data-field-street]")?.textContent?.includes("7th"), null, { timeout: 15000 });
      await page.getByText("Damage probability").waitFor({ timeout: 15000 });
      await page.locator("[data-hail-proof]").waitFor({ timeout: 15000 });
      await page.locator("[data-sheet-scroll]").evaluate((el) => {
        const button = el.querySelector("[data-hail-proof]");
        button?.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(400);
      const file = `${outDir}/${label}-${name}-field.png`;
      await page.screenshot({ path: file });
      console.log("wrote", file);
      await context.close();
    }
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const created = await page.evaluate(async (body) => {
    const response = await fetch("/api/hail-proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    return { status: response.status, payload };
  }, draft);
  console.log("created", JSON.stringify(created));
  if (created.status !== 201 || !created.payload?.id) throw new Error("could not create proof");
  await context.close();
  await shootProof(browser, created.payload.id);
  await shootField(browser);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
