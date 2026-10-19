import { requireDevice } from "@/lib/alert-http";
import { isIanaTimeZone } from "@/lib/alert-model";
import { allowedPushEndpoint, deleteDevice, saveSubscription } from "@/lib/alert-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const subscription = record.subscription && typeof record.subscription === "object" ? (record.subscription as Record<string, unknown>) : null;
  const keys = subscription?.keys && typeof subscription.keys === "object" ? (subscription.keys as Record<string, unknown>) : null;
  const endpoint = typeof subscription?.endpoint === "string" ? subscription.endpoint : "";
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys?.auth === "string" ? keys.auth : "";
  if (!endpoint || !p256dh || !auth) return Response.json({ error: "A push subscription is required" }, { status: 400 });
  if (!allowedPushEndpoint(endpoint)) return Response.json({ error: "That push service is not supported" }, { status: 400 });
  const timeZone = typeof record.timeZone === "string" && isIanaTimeZone(record.timeZone) ? record.timeZone.trim() : null;
  const device = saveSubscription({ endpoint, p256dh, auth, timeZone });
  return Response.json({ deviceKey: device.deviceKey, subscriptionId: device.id });
}

export function DELETE(request: Request) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  deleteDevice(auth.device.id);
  return Response.json({ ok: true });
}
