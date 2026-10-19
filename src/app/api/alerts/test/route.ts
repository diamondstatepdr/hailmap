import { requireDevice } from "@/lib/alert-http";
import { claimEvent, markEvent, markTestSent } from "@/lib/alert-store";
import { sendWebPush } from "@/lib/web-push-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = requireDevice(request);
  if ("response" in auth) return auth.response;
  const device = auth.device;
  const last = device.lastTestAt ? Date.parse(device.lastTestAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < 15_000) {
    return Response.json({ error: "Wait a few seconds before another test" }, { status: 429 });
  }
  const now = new Date().toISOString();
  const title = "HailMap test";
  const body = "Alerts are on. This is a test ping.";
  const url = "/?section=alerts";
  const stormKey = `test:${device.id}:${Date.now()}`;
  const event = claimEvent({
    subscriptionId: device.id,
    areaId: "test",
    stormKey,
    kind: "test",
    title,
    body,
    place: "This phone",
    sizeIn: null,
    occurredAt: now,
    lat: device.lat,
    lon: device.lon,
    url,
    status: "pending",
  });
  if (!event) return Response.json({ error: "Could not record the test" }, { status: 500 });
  const result = await sendWebPush(
    { endpoint: device.endpoint, p256dh: device.p256dh, auth: device.auth },
    { title, body, url, tag: stormKey },
    120,
  );
  markEvent(event.id, result);
  if (result === "expired") return Response.json({ error: "This browser's push subscription expired. Turn alerts on again." }, { status: 410 });
  if (result !== "sent") return Response.json({ error: "The push service did not accept the test" }, { status: 502 });
  markTestSent(device.id);
  return Response.json({ ok: true, event });
}
