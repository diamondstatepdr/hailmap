import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

const mesa = { lat: 33.415, lon: -111.837 };

function contains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function mesaBands() {
  const file = "/tmp/mesh-oct20.json";
  if (!existsSync(file)) return { rings: [], colors: [] };
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const features = doc.collection?.features ?? [];
  const frame = { west: mesa.lon - 0.012, east: mesa.lon + 0.012, south: mesa.lat - 0.01, north: mesa.lat + 0.01 };
  const corners = [
    [frame.west, frame.south],
    [frame.east, frame.south],
    [frame.east, frame.north],
    [frame.west, frame.north],
  ];
  const bands = [];
  for (const feature of features) {
    const ring = feature.geometry?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const hit = contains(ring, mesa.lon, mesa.lat) || corners.some(([lon, lat]) => contains(ring, lon, lat));
    if (!hit) continue;
    const step = Math.max(1, Math.ceil(ring.length / 80));
    const simplified = ring.filter((_, index) => index % step === 0).slice(0, 80);
    bands.push({ ring: simplified, color: feature.properties?.color ?? "#f97316", minIn: feature.properties?.minIn ?? 0 });
  }
  bands.sort((a, b) => a.minIn - b.minIn);
  return { rings: bands.map((band) => band.ring), colors: bands.map((band) => band.color) };
}

const meshBands = mesaBands();
const draft = {
  address: "East Main Street, Mesa, AZ",
  lat: mesa.lat,
  lon: mesa.lon,
  company: "Diamond State PDR",
  phone: "480-800-0148",
  maxHailIn: 2.53,
  score: 72,
  level: "High",
  summary: "Radar hail on Oct 20, 2026 covers this Mesa block. Treat the score as an estimate.",
  storms: [{ date: "2026-10-20", label: "Oct 20, 2026", hailIn: 2.53 }],
  nearby: [{ when: "Oct 20, 2026", where: "3 ENE Mesa", detail: "2.00 in hail" }],
  rings: meshBands.rings,
  colors: meshBands.colors,
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
      await page.goto(`${base}/proof/${id}?scheme=light&theme=${theme}`, { waitUntil: "domcontentloaded" });
      await page.locator("[data-hail-proof-page]").waitFor();
      await page.locator("h2", { hasText: "East Main Street, Mesa" }).waitFor();
      await page.getByText("Diamond State PDR").waitFor();
      await page.locator(".proof-map svg").waitFor();
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
          body: JSON.stringify({ lat, lon, street: "East Main Street, Mesa, AZ", streetStatus: "ok" }),
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
      await page.goto(`${base}/?lat=33.415&lon=-111.837&z=14&day=2026-10-20&scheme=light&theme=${theme}`, { waitUntil: "domcontentloaded" });
      await page.locator(".maplibregl-canvas").waitFor({ timeout: 20000 });
      await page.getByRole("button", { name: /^Field/ }).click();
      await page.locator("[data-field-street]").waitFor({ timeout: 15000 });
      await page.waitForFunction(() => /Main|Mesa/i.test(document.querySelector("[data-field-street]")?.textContent ?? ""), null, { timeout: 15000 });
      await page.getByText("Damage probability").waitFor({ timeout: 15000 });
      await page.getByLabel("Company name").fill("Diamond State PDR");
      await page.getByLabel("Phone").fill("480-800-0148");
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
