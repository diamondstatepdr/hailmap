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

function placePayload(lat, lon) {
  return {
    lat,
    lon,
    radiusKm: 8,
    hours: 168,
    reports: [],
    maxHailIn: 1.07,
    maxWindMph: null,
    strongestTornado: null,
    nearestKm: 1.2,
    swathHit: true,
    swathMaxSizeIn: 1.07,
    warnings: [],
    warningStatus: "ok",
    score: {
      score: 64,
      level: "High",
      summary: "1.07 in radar hail is the strongest evidence at this stop.",
      factors: [{ id: "size", label: "Hail size", points: 40, detail: "1.07 in within this stop" }],
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
      await page.locator(".proof-map svg").waitFor();
      const proofText = await page.locator("[data-hail-proof-page]").innerText();
      if (/480-|Diamond State|Company · phone/i.test(proofText)) throw new Error(`proof page shipped a contact line: ${proofText.slice(0, 240)}`);
      if ((await page.locator(".proof-company").count()) !== 0) throw new Error("blank company line still rendered");
      const confirmText = await page.locator("[data-proof-confirm]").innerText();
      if (!/radar \+\s*spotter\s*confirmed|radar only/i.test(confirmText)) throw new Error(`missing radar status: ${confirmText.slice(0, 300)}`);
      if (!/UTC/.test(confirmText)) throw new Error("radar time is missing UTC");
      if (!/not a meteorologist certification/i.test(confirmText) || !/not an insurance decision/i.test(confirmText)) {
        throw new Error(`disclaimer missing: ${confirmText.slice(0, 400)}`);
      }
      const sealed = /radar \+\s*spotter\s*confirmed/i.test(confirmText);
      if (sealed) {
        if ((await page.locator("[data-proof-seal]").count()) !== 1) throw new Error("confirmed proof has no seal");
        if (!/Local Storm Report/.test(confirmText)) throw new Error("confirmed proof is missing the spotter source");
        if (!/\d+\.\d+ mi/.test(confirmText)) throw new Error("confirmed proof is missing distance");
      } else if ((await page.locator("[data-proof-seal]").count()) !== 0) {
        throw new Error("radar-only proof still drew a seal");
      }
      if (!/42 mi long/.test(proofText)) throw new Error(`swath caption drifted: ${proofText.match(/\d+ mi long[^\n]*/)?.[0] ?? "missing"}`);
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
      const company = page.getByLabel("Your company");
      const phoneField = page.getByLabel("Your phone");
      await company.waitFor({ timeout: 15000 });
      if ((await company.inputValue()) || (await phoneField.inputValue())) {
        throw new Error("company and phone should start empty");
      }
      await page.locator("[data-hail-proof]").waitFor({ timeout: 15000 });
      await page.locator(".proof-launch").evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
      const file = `${outDir}/${label}-${name}-field.png`;
      await page.screenshot({ path: file });
      console.log("wrote", file);
      await context.close();
    }
  }
}

async function createProofFromField(browser) {
  const context = await browser.newContext({ ...phone, serviceWorkers: "block" });
  const page = await context.newPage();
  await hideDev(page);
  await page.route("**/api/geocode?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lat: Number(url.searchParams.get("lat")),
        lon: Number(url.searchParams.get("lon")),
        street: "East Main Street, Mesa, AZ",
        streetStatus: "ok",
      }),
    });
  });
  await page.route("**/api/place?**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(placePayload(Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon")))),
    });
  });
  const mesh = page.waitForResponse((response) => response.url().includes("/api/mesh") && response.ok(), { timeout: 25000 });
  await page.goto(`${base}/?lat=33.415&lon=-111.837&z=14&day=2026-10-20&scheme=light&theme=a`, { waitUntil: "domcontentloaded" });
  await mesh;
  await page.getByRole("button", { name: /^Field/ }).click();
  await page.locator("[data-field-street]").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /Main|Mesa/i.test(document.querySelector("[data-field-street]")?.textContent ?? ""), null, { timeout: 15000 });
  await page.locator("[data-hail-proof]").waitFor({ timeout: 20000 });
  const posted = page.waitForResponse(
    (response) => response.url().includes("/api/hail-proof") && !response.url().includes("/identity") && response.request().method() === "POST",
    { timeout: 120000 },
  );
  await page.locator("[data-hail-proof]").click();
  const response = await posted;
  const payload = await response.json();
  const body = response.request().postDataJSON();
  console.log("swathLine", body?.swathLine);
  if (!body?.swathLine || !/mi long/.test(body.swathLine)) throw new Error(`missing swath caption: ${body?.swathLine}`);
  if (body.stormDate !== "2026-10-20") throw new Error(`storm date was ${body?.stormDate}`);
  if (body.company || body.phone) throw new Error("generated proof included a company or phone");
  await context.close();
  if (response.status() !== 201 || !payload?.id) throw new Error("could not create proof from the field");
  return payload.id;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const id = await createProofFromField(browser);
  console.log("created", id);
  await shootProof(browser, id);
  await shootField(browser);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
