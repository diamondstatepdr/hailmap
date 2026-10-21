import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const mode = process.argv[2] ?? "after";
const out = process.env.USABILITY_SHOTS ?? (mode === "before" ? "/opt/cursor/artifacts/screens/before" : "/opt/cursor/artifacts/screens/after");
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const themes = [
  ["a", "storm-core"],
  ["b", "supercell"],
  ["c", "ice-swath"],
];

const honey = {
  date: "2026-10-19",
  label: "Oct 19, 2026",
  live: false,
  partial: false,
  status: "complete",
  zoom: false,
  note: null,
  attribution: "Lots and apartments © OpenStreetMap contributors.",
  updatedAt: "2026-10-21T12:41:17.595Z",
  spots: {
    pdr: [
      { id: "post", name: "Post Apartments area", kind: "apartments", lat: 32.269, lon: -107.747, hailIn: 2.23, radarIn: 2.23, spotterIn: 1.25, vehicles: 1608, homes: 28, score: 86, level: "Very High", distanceKm: 1.6, sourceLabel: "Radar and spotter agree" },
      { id: "sw", name: "Deming southwest", kind: "parking", lat: 32.25, lon: -107.788, hailIn: 2.03, radarIn: 2.03, spotterIn: 1.25, vehicles: 412, homes: null, score: 76, level: "Very High", distanceKm: 2.9, sourceLabel: "Radar and spotter agree" },
    ],
    roof: [],
  },
  heat: { pdr: { type: "FeatureCollection", features: [] }, roof: { type: "FeatureCollection", features: [] } },
};

async function hidePortal(page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
}

async function main() {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  for (const [theme, name] of themes) {
    const context = await browser.newContext({ ...phone, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem("hailmap-chase-popup:2026-W43", "1");
    });
    if (mode === "after") {
      await page.route("**/api/honey?**", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(honey) });
      });
    }
    await page.goto(`${base}/?theme=${theme}&scheme=dark`, { waitUntil: "domcontentloaded" });
    await page.locator(".maplibregl-map").waitFor({ timeout: 20000 });
    if (mode === "after") {
      await page.locator("[data-welcome]").waitFor({ timeout: 10000 });
      for (let step = 1; step <= 3; step += 1) {
        await page.locator(`[data-welcome-step="${step}"]`).waitFor();
        await hidePortal(page);
        await page.screenshot({ path: `${out}/welcome-${step}-${name}.png` });
        if (step < 3) await page.locator("[data-welcome-next]").tap();
      }
      await page.locator("[data-welcome-done]").tap();
      await page.locator("[data-welcome]").waitFor({ state: "detached", timeout: 5000 });
    }
    await page.waitForTimeout(700);
    await hidePortal(page);
    const chrome = await page.evaluate(() => ({
      chase: document.querySelectorAll("[data-chase-open]").length,
      helpBars: document.querySelectorAll(".help-open").length,
      closeBar: document.body.innerText.includes("Close money spots"),
      states: document.body.innerText.includes("States ·"),
    }));
    if (chrome.chase !== 1 || chrome.helpBars || chrome.closeBar || chrome.states) {
      throw new Error(`Map chrome is still crowded (${name}): ${JSON.stringify(chrome)}`);
    }
    await page.screenshot({ path: `${out}/map-${name}.png` });
    await page.locator(".tab-bar").getByRole("button", { name: "Storms" }).tap();
    await page.locator("[data-chase-section]").waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
    await hidePortal(page);
    await page.screenshot({ path: `${out}/storms-${name}.png` });
    await page.locator(".tab-bar").getByRole("button", { name: "Map" }).tap();
    const money = page.locator("[data-honey-open]");
    await money.tap();
    await page.locator("[data-honey-panel]").waitFor({ timeout: 10000 });
    if (mode === "after") {
      await page.goto(`${base}/?theme=${theme}&scheme=dark&lat=32.08&lon=-107.76&z=9&day=2026-10-19`, { waitUntil: "domcontentloaded" });
      await page.locator(".maplibregl-map").waitFor({ timeout: 20000 });
      await page.locator("[data-welcome]").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
      await page.locator("[data-honey-open]").tap();
      await page.locator("[data-honey-panel]").waitFor({ timeout: 10000 });
      await page.waitForFunction(() => document.body.innerText.includes("Deming") || document.body.innerText.includes("Post Apartments"));
      await page.waitForTimeout(800);
      const overlap = await page.evaluate(() => {
        const panel = document.querySelector("[data-honey-panel]");
        const credit = document.querySelector(".maplibregl-ctrl-bottom-right");
        if (!panel || !credit) return { missing: true };
        const a = panel.getBoundingClientRect();
        const b = credit.getBoundingClientRect();
        const hit = b.bottom > a.top + 1 && b.top < a.bottom && b.right > a.left && b.left < a.right;
        return { hit, panelTop: Math.round(a.top), creditBottom: Math.round(b.bottom), creditTop: Math.round(b.top) };
      });
      if (overlap.hit || overlap.missing) {
        throw new Error(`Map credit overlaps the money spots panel (${name}): ${JSON.stringify(overlap)}`);
      }
    }
    await hidePortal(page);
    await page.screenshot({ path: `${out}/money-${name}.png` });
    await context.close();
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
