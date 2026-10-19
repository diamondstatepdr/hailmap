import webpush from "web-push";
import { getVapid } from "@/lib/vapid";

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

let configuredKey = "";

function configure() {
  const keys = getVapid();
  const stamp = `${keys.publicKey}:${keys.subject}`;
  if (stamp === configuredKey) return;
  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  configuredKey = stamp;
}

export async function sendWebPush(target: PushTarget, payload: PushPayload, ttlSeconds = 4 * 3600): Promise<"sent" | "expired" | "failed"> {
  configure();
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: payload.tag ?? "" }),
      { TTL: ttlSeconds, urgency: "high" },
    );
    return "sent";
  } catch (error) {
    const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 0;
    if (status === 404 || status === 410) return "expired";
    const message = error instanceof Error ? error.message : "push failed";
    console.error("[hailmap] push", status || "", message);
    return "failed";
  }
}
