import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inQuietHours } from "@/lib/alert-model";
import {
  iosSafariNeedsInstall,
  shellCacheDecision,
  shouldOfferInstall,
  stormPayloadCacheable,
} from "@/lib/pwa-policy";

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("install prompt", () => {
  it("shows until the person dismisses it, and stays hidden on the home screen", () => {
    expect(shouldOfferInstall({ dismissed: false, standalone: false, force: false })).toBe(true);
    expect(shouldOfferInstall({ dismissed: true, standalone: false, force: false })).toBe(false);
    expect(shouldOfferInstall({ dismissed: false, standalone: true, force: false })).toBe(false);
    expect(shouldOfferInstall({ dismissed: true, standalone: true, force: true })).toBe(true);
  });

  it("asks iPhone Safari to install before alerts, and not once the icon is already open", () => {
    const iphone = {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
      standalone: false,
    };
    expect(iosSafariNeedsInstall(iphone)).toBe(true);
    expect(iosSafariNeedsInstall({ ...iphone, standalone: true })).toBe(false);
    expect(
      iosSafariNeedsInstall({
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        maxTouchPoints: 5,
        standalone: false,
      }),
    ).toBe(false);
  });
});

describe("offline shell", () => {
  it("caches the app shell and never stores storm data that has no Updated time", () => {
    expect(shellCacheDecision({ method: "GET", pathname: "/", sameOrigin: true })).toBe("shell");
    expect(shellCacheDecision({ method: "GET", pathname: "/manifest.webmanifest", sameOrigin: true })).toBe("shell");
    expect(shellCacheDecision({ method: "GET", pathname: "/icons/icon-192.png", sameOrigin: true })).toBe("shell");
    expect(shellCacheDecision({ method: "GET", pathname: "/api/reports", sameOrigin: true })).toBe("network");
    expect(shellCacheDecision({ method: "GET", pathname: "/api/mesh", sameOrigin: true })).toBe("network");
    expect(shellCacheDecision({ method: "GET", pathname: "/api/history/place", sameOrigin: true })).toBe("network");
    expect(shellCacheDecision({ method: "POST", pathname: "/", sameOrigin: true })).toBe("bypass");
    expect(shellCacheDecision({ method: "GET", pathname: "/map/light.json", sameOrigin: true })).toBe("bypass");
    expect(stormPayloadCacheable({ reports: [] })).toBe(false);
    expect(stormPayloadCacheable({ reports: [], updated: "2026-10-21T17:00:00.000Z" })).toBe(true);
    expect(stormPayloadCacheable({ updated: "" })).toBe(false);
  });

  it("keeps the service worker on that policy and still receives Web Push", () => {
    const worker = readFileSync("public/sw.js", "utf8");
    expect(worker).toContain('pathname.startsWith("/api/")');
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain("showNotification");
    expect(worker).not.toContain("display-mode: standalone");
    expect(inQuietHours(new Date("2026-10-21T08:30:00Z"), "22:00", "07:00", "America/Chicago")).toBe(true);
  });
});

describe("install card", () => {
  it("uses the app icon, numbered steps, and a native install button when Chrome offers one", () => {
    const source = readFileSync("src/components/InstallPrompt.tsx", "utf8");
    expect(source).toContain('src="/icons/icon-192.png"');
    expect(source).toContain("Install Swathline");
    expect(source).toContain("Got it");
    expect(source).toContain("installEvent ?");
    expect(source).toContain("<Share");
    expect(source).toContain("<EllipsisVertical");
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("body:has([data-install-prompt]) .map-legend");
    expect(css).toContain("body:has([data-install-prompt]) .maplibregl-ctrl-bottom-right");
  });
});

describe("manifest", () => {
  it("is installable with the Swathline icon, a theme color, and standalone display", () => {
    const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8")) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      theme_color: string;
      background_color: string;
      icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
    };
    expect(manifest.name).toBe("Swathline");
    expect(manifest.short_name).toBe("Swathline");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    const sizes = new Set(manifest.icons.map((icon) => icon.sizes));
    for (const size of ["192x192", "512x512"]) {
      expect(sizes.has(size)).toBe(true);
    }
    expect(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512")).toBe(true);
    expect(manifest.icons.some((icon) => icon.purpose === "any" && icon.sizes === "192x192")).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      const [width, height] = icon.sizes.split("x").map(Number);
      const actual = pngSize(`public${icon.src}`);
      expect(actual).toEqual({ width, height });
    }
  });
});
