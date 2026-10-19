const DEVICE_KEY = "hailmap-device-key";

export function storedDeviceKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(DEVICE_KEY);
}

export function rememberDeviceKey(key: string) {
  localStorage.setItem(DEVICE_KEY, key);
}

export function clearDeviceKey() {
  localStorage.removeItem(DEVICE_KEY);
}

export function deviceHeaders(): HeadersInit {
  const key = storedDeviceKey();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["x-hailmap-device"] = key;
  return headers;
}

export function iosNeedsHomeScreen(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iOS && safari && !standalone;
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export async function enablePush(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser cannot receive push alerts");
  }
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission is blocked");
  const keyResponse = await fetch("/api/alerts/vapid");
  const keyPayload = (await keyResponse.json()) as { publicKey?: string; error?: string };
  if (!keyResponse.ok || !keyPayload.publicKey) throw new Error(keyPayload.error ?? "Alerts are not configured");
  const current = await registration.pushManager.getSubscription();
  const subscription =
    current ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyPayload.publicKey) as BufferSource,
    }));
  const response = await fetch("/api/alerts/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  const payload = (await response.json()) as { deviceKey?: string; error?: string };
  if (!response.ok || !payload.deviceKey) throw new Error(payload.error ?? "Could not save this phone");
  rememberDeviceKey(payload.deviceKey);
}

export async function ensurePush(): Promise<void> {
  if (storedDeviceKey()) {
    const ready = await navigator.serviceWorker?.getRegistration("/");
    const existing = await ready?.pushManager.getSubscription();
    if (existing) return;
  }
  await enablePush();
}
