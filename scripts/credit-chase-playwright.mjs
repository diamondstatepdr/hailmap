import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:3210";
const phone = { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
const errors = [];

function watch(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${tag} ${msg.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`${tag} ${error.message}`));
}

async function zoom(page) {
  const raw = await page.locator(".maplibregl-map").getAttribute("data-map-zoom");
  return Number(raw);
}

async function waitZoom(page, accept) {
  let last = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    last = await zoom(page);
    if (accept(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`zoom stayed ${last}`);
}

async function creditCycle(page, tag) {
  const button = page.locator(".maplibregl-ctrl-attrib-button");
  await button.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => {
    const root = document.querySelector(".maplibregl-ctrl-attrib");
    return root?.getAttribute("data-credit") === "closed" || root?.getAttribute("data-credit") === "open";
  });
  if (tag.includes("phone")) await button.tap();
  else await button.click();
  await page.waitForFunction(() => document.querySelector(".maplibregl-ctrl-attrib")?.getAttribute("data-credit") === "open");
  const open = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => ({
    display: getComputedStyle(el).display,
    text: el.textContent ?? "",
    box: el.getBoundingClientRect(),
  }));
  if (open.display === "none" || !open.text.includes("OpenStreetMap")) {
    throw new Error(`${tag} credit did not open: ${JSON.stringify(open)}`);
  }
  const vp = page.viewportSize();
  if (!vp || open.box.width < 40 || open.box.x < -1 || open.box.right > vp.width + 1 || open.box.y < -1 || open.box.bottom > vp.height + 1) {
    throw new Error(`${tag} credit is clipped ${JSON.stringify(open.box)}`);
  }
  await page.waitForTimeout(50);
  if (tag.includes("phone")) await button.tap();
  else await button.click();
  await page.waitForFunction(() => document.querySelector(".maplibregl-ctrl-attrib")?.getAttribute("data-credit") === "closed");
  const closed = await page.locator(".maplibregl-ctrl-attrib-inner").evaluate((el) => getComputedStyle(el).display);
  if (closed !== "none") throw new Error(`${tag} credit stayed open`);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const palette of ["a", "b", "c"]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext(phone);
      const page = await context.newPage();
      const tag = `phone ${palette} ${scheme}`;
      watch(page, tag);
      await page.goto(`${base}/?theme=${palette}&scheme=${scheme}&lat=32.7555&lon=-97.3308&z=10.5`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
      await creditCycle(page, tag);
      const stayed = await waitZoom(page, (value) => value > 8);
      if (stayed < 8) throw new Error(`${tag} share link zoom drifted to ${stayed}`);
      await context.close();
      console.log(tag, "credit ok", stayed.toFixed(2));
    }
  }

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const desk = await desktop.newPage();
  watch(desk, "desktop");
  await desk.goto(`${base}/?theme=a&scheme=dark&lat=32.7555&lon=-97.3308&z=10.5`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await desk.waitForSelector(".maplibregl-canvas", { timeout: 30000 });
  await creditCycle(desk, "desktop");
  await desktop.close();
  console.log("desktop credit ok");

  const plain = await browser.newContext(phone);
  const page = await plain.newPage();
  watch(page, "plain");
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-chase-popup]", { timeout: 20000 });
  const framed = await waitZoom(page, (value) => value >= 2 && value <= 3.4);
  console.log("country frame", framed.toFixed(2));
  await page.locator("[data-chase-popup]").getByRole("button", { name: "Close" }).tap();
  await page.locator("[data-chase-popup]").waitFor({ state: "hidden" });
  const restored = await waitZoom(page, (value) => value >= 3.5);
  console.log("restored", restored.toFixed(2));
  await plain.close();

  const saved = await browser.newContext(phone);
  await saved.addInitScript(() => {
    localStorage.setItem("hailmap-view", JSON.stringify({ lat: 32.75, lon: -97.33, zoom: 11 }));
  });
  const savedPage = await saved.newPage();
  watch(savedPage, "saved");
  await savedPage.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await savedPage.waitForSelector("[data-chase-popup]", { timeout: 20000 });
  const overSaved = await waitZoom(savedPage, (value) => value >= 2 && value <= 3.4);
  console.log("frame over saved view", overSaved.toFixed(2));
  await savedPage.locator("[data-chase-popup]").getByRole("button", { name: "Close" }).tap();
  const back = await waitZoom(savedPage, (value) => value >= 9);
  console.log("saved view restored", back.toFixed(2));
  await saved.close();

  const row = await browser.newContext(phone);
  const rowPage = await row.newPage();
  watch(rowPage, "row");
  await rowPage.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await rowPage.waitForSelector("[data-chase-stop]", { timeout: 20000 });
  await rowPage.locator("[data-chase-stop]").first().tap();
  await rowPage.locator("[data-chase-popup]").waitFor({ state: "hidden", timeout: 10000 });
  const flown = await waitZoom(rowPage, (value) => value >= 8);
  console.log("row fly-to", flown.toFixed(2));
  await row.close();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("credit and chase frame ok");
}
