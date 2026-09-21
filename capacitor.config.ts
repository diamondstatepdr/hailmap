import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Release builds load the deployed HTTPS app inside the WebView.
 * Cleartext HTTP is disabled. Set CAPACITOR_SERVER_URL to the Railway https origin.
 */
function releaseServerUrl(): string | undefined {
  const url = process.env.CAPACITOR_SERVER_URL?.trim();
  if (!url) return undefined;
  if (!/^https:\/\//i.test(url)) {
    throw new Error("CAPACITOR_SERVER_URL must be an https:// URL");
  }
  return url.replace(/\/$/, "");
}

const serverUrl = releaseServerUrl();

const config: CapacitorConfig = {
  appId: "com.hailmap.app",
  appName: "HailMap",
  webDir: "www",
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
    cleartext: false,
    ...(serverUrl ? { url: serverUrl } : {}),
  },
};

export default config;
