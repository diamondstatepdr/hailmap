import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const outDir = process.env.FIELD_SHOTS ?? "/opt/cursor/artifacts/screens";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const errors = [];

function phoenixStreet(lat, lon) {
  const arizona = lat > 31.5 && lat < 35.2 && lon < -109 && lon > -115;
  return arizona ? "E Washington St, Phoenix" : "W Broadway St, Morrilton";
}

function placePayload(lat, lon) {
  return {
    lat,
    lon,
    radiusKm: 8,
    hours: 168,
    reports: [],
    maxHailIn: null,
    maxWindMph: null,
    strongestTornado: null,
    nearestKm: null,
    swathHit: false,
    swathMaxSizeIn: null,
    warnings: [],
    warningStatus: "ok",
    score: {
      score: 42,
      level: "High",
      summary: "Possible hail damage nearby.",
      factors: [
        { id: "size", label: "Hail size", points: 24, detail: "1.25 in within this stop" },
        { id: "recent", label: "Recent", points: 18, detail: "Reports in the last week" },
      ],
    },
  };
}

async function installRoutes(page, hits) {
  await page.route("**/api/geocode?**", async (route) => {
    const url = new URL(route.request().url());
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      await route.continue();
      return;
    }
    hits.push({ lat, lon });
    const street = phoenixStreet(lat, lon);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ lat, lon, street, streetStatus: "ok" }),
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
}

async function mapCenter(page) {
  return page.locator(".maplibregl-map").evaluate((el) => ({
    lat: Number(el.getAttribute("data-map-lat")),
    lon: Number(el.getAttribute("data-map-lon")),
    zoom: Number(el.getAttribute("data-map-zoom")),
  }));
}

async function waitCenter(page, accept) {
  let last = { lat: 0, lon: 0, zoom: 0 };
  for (let attempt = 0; attempt < 50; attempt += 1) {
    last = await mapCenter(page);
    if (accept(last)) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`map stayed at ${last.lat}, ${last.lon} z${last.zoom}`);
}

function inArizona(center) {
  return center.lat > 31.5 && center.lat < 35.2 && center.lon < -109 && center.lon > -115;
}

function inMorrilton(center) {
  return Math.abs(center.lat - 35.15) < 0.25 && Math.abs(center.lon + 92.74) < 0.35;
}

async function openField(page, theme, scheme) {
  const url = `${base}/?lat=33.45&lon=-112.07&z=9&theme=${theme}&scheme=${scheme}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitCenter(page, inArizona);
  await page.locator(".tab-bar").getByRole("button", { name: "Field" }).tap();
  await page.locator("[data-field-street]").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelector("[data-field-street]")?.textContent?.includes("Phoenix"));
  return waitCenter(page, inArizona);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...phone,
    geolocation: { latitude: 35.15, longitude: -92.74 },
    permissions: ["geolocation"],
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const hits = [];
  await installRoutes(page, hits);

  const entered = await openField(page, "a", "dark");
  const beforeRoundTrip = await mapCenter(page);
  await page.locator(".tab-bar").getByRole("button", { name: "Map" }).tap();
  await page.waitForTimeout(400);
  await page.locator(".tab-bar").getByRole("button", { name: "Field" }).tap();
  await page.waitForFunction(() => document.querySelector("[data-field-street]")?.textContent?.includes("Phoenix"));
  const afterRoundTrip = await waitCenter(page, inArizona);
  const dotBefore = await page.locator("[aria-label='Your location']").count();
  await page.getByRole("button", { name: "My location" }).tap();
  await page.locator("[aria-label='Your location']").waitFor({ state: "attached", timeout: 10000 });
  await page.waitForTimeout(800);
  const afterDot = await waitCenter(page, inArizona);
  const streetAfterDot = await page.locator("[data-field-street]").innerText();
  const hitsBeforeCenter = hits.slice();
  await page.getByRole("button", { name: "Center on me" }).tap();
  const morrilton = await waitCenter(page, inMorrilton);
  await page.waitForFunction(() => document.querySelector("[data-field-street]")?.textContent?.includes("Morrilton"));
  const streetAfterCenter = await page.locator("[data-field-street]").innerText();

  const log = {
    entered,
    beforeRoundTrip,
    afterRoundTrip,
    dotBefore,
    afterDot,
    streetAfterDot,
    morrilton,
    streetAfterCenter,
    geocodeHits: hits,
    hitsBeforeCenter,
    errors,
  };
  writeFileSync(`${outDir}/field-anchor-log.json`, JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 2));
  if (!streetAfterDot.includes("Phoenix")) throw new Error(`street moved on My location: ${streetAfterDot}`);
  if (dotBefore !== 0) throw new Error("location dot was showing before My location");
  if (hitsBeforeCenter.some((hit) => hit.lat > 34.5 && hit.lon > -100)) {
    throw new Error(`geocode hit Morrilton before Center on me: ${JSON.stringify(hitsBeforeCenter)}`);
  }
  await context.close();

  const themes = [
    ["a", "dark", "storm-core-dark"],
    ["b", "dark", "supercell-dark"],
    ["c", "dark", "ice-swath-dark"],
    ["a", "light", "storm-core-light"],
    ["b", "light", "supercell-light"],
    ["c", "light", "ice-swath-light"],
  ];
  for (const [theme, scheme, name] of themes) {
    const shotContext = await browser.newContext({
      ...phone,
      geolocation: { latitude: 35.15, longitude: -92.74 },
      permissions: ["geolocation"],
      serviceWorkers: "block",
    });
    const shot = await shotContext.newPage();
    await installRoutes(shot, []);
    await openField(shot, theme, scheme);
    await shot.screenshot({ path: `${outDir}/field-${name}.png` });
    await shotContext.close();
  }
  await browser.close();
  const pageErrors = errors.filter((line) => !/Failed to load resource|favicon|tile|sprite/i.test(line));
  if (pageErrors.length) {
    console.error(pageErrors.join("\n"));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
