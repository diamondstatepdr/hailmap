/** What the service worker may store. Storm feeds stay on the network. */

export type ShellCacheDecision = "shell" | "network" | "bypass";

const SHELL_EXACT = new Set(["/", "/privacy", "/manifest.webmanifest"]);

export function shellCacheDecision(input: { method: string; pathname: string; sameOrigin: boolean }): ShellCacheDecision {
  if (!input.sameOrigin || input.method !== "GET") return "bypass";
  if (input.pathname === "/sw.js") return "bypass";
  if (input.pathname.startsWith("/api/") || input.pathname.startsWith("/_next/data/")) return "network";
  if (SHELL_EXACT.has(input.pathname) || input.pathname.startsWith("/icons/") || input.pathname.startsWith("/brand/")) {
    return "shell";
  }
  return "bypass";
}

/** A storm payload may be stored only when it carries a real Updated time. */
export function stormPayloadCacheable(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const updated = (body as { updated?: unknown }).updated;
  return typeof updated === "string" && updated.trim().length > 0;
}

export const INSTALL_DISMISS_KEY = "swathline-install-dismissed";

export function shouldOfferInstall(input: { dismissed: boolean; standalone: boolean; force: boolean }): boolean {
  if (input.force) return true;
  return !input.dismissed && !input.standalone;
}

/** iPhone Safari cannot subscribe to Web Push until the site is opened from the Home Screen. */
export function iosSafariNeedsInstall(input: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
}): boolean {
  const iOS = /iPad|iPhone|iPod/.test(input.userAgent) || (input.platform === "MacIntel" && input.maxTouchPoints > 1);
  const safari = /Safari/i.test(input.userAgent) && !/CriOS|FxiOS|EdgiOS/i.test(input.userAgent);
  return iOS && safari && !input.standalone;
}
