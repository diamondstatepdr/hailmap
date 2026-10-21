import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as signIn } from "@/app/api/auth/session/route";
import { POST as createPin } from "@/app/api/field/pins/route";
import { POST as sendLeadRoute } from "@/app/api/crm/leads/route";
import { GET as readSettings, PUT as writeSettings } from "@/app/api/crm/settings/route";
import { POST as testRoute } from "@/app/api/crm/test/route";
import {
  acculynxJob,
  addressFromNominatim,
  crmNetwork,
  isBlockedAddress,
  jobNimbusContact,
  publicCrm,
  saveCrm,
  sendLeads,
  testCrm,
  webhookTarget,
  type OutboundLead,
} from "@/lib/crm";
import { formatSentClock } from "@/lib/sent-clock";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-crm-"));
process.env.HAILMAP_DATA_DIR = dataDir;
process.env.HAILMAP_TEAM_PASSCODE = "team-pass";
process.env.HAILMAP_AUTH_SECRET = "test-secret-key";

const originalFetch = crmNetwork.fetch;
const originalResolve = crmNetwork.resolve;
const webhook = "https://hooks.zapier.com/hooks/catch/123/abc";
const apiKey = "jn-live-key-not-a-phone";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  crmNetwork.fetch = originalFetch;
  crmNetwork.resolve = originalResolve;
});

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function session() {
  const response = await signIn(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alex", passcode: "team-pass" }),
    }),
  );
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

const norman: OutboundLead = {
  id: "pin-norman",
  status: "lead",
  note: "Owner asked for a quote",
  lat: 35.2226,
  lon: -97.4395,
  street: "West Gray Street",
  city: "Norman",
  state: "Oklahoma",
  postalCode: "73069",
  country: "USA",
};

describe("crm destinations", () => {
  it("shows the last send in the device time zone", () => {
    const at = "2026-10-21T18:13:01.722Z";
    expect(formatSentClock(at, "America/Chicago")).toBe("Oct 21, 1:13 PM CDT");
    expect(formatSentClock(at, "UTC")).toBe("Oct 21, 6:13 PM UTC");
  });

  it("blocks private webhook addresses and allows a public https link", async () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("192.168.1.9")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    crmNetwork.resolve = async () => ["127.0.0.1"];
    expect(await webhookTarget("http://hooks.zapier.com/hooks/catch/1/a")).toEqual({ error: "The link has to start with https." });
    expect("error" in (await webhookTarget(webhook))).toBe(true);
    crmNetwork.resolve = async () => ["8.8.8.8"];
    expect(await webhookTarget(webhook)).toEqual({ url: webhook });
  });

  it("reads a real Nominatim address and does not invent a phone number", () => {
    const address = addressFromNominatim({
      address: {
        road: "West Gray Street",
        city: "Norman",
        state: "Oklahoma",
        postcode: "73069",
        country_code: "us",
      },
    });
    expect(address).toMatchObject({ street: "West Gray Street", city: "Norman", state: "Oklahoma", postalCode: "73069", country: "USA" });
    const contact = jobNimbusContact(norman, "Customer", "Lead");
    expect(contact.record_type_name).toBe("Customer");
    expect(contact.status_name).toBe("Lead");
    expect(contact.geo).toEqual({ lat: 35.2226, lon: -97.4395 });
    expect(JSON.stringify(contact)).not.toContain("555");
    expect(acculynxJob(norman, "contact-1").locationAddress).toEqual({
      street1: "West Gray Street",
      city: "Norman",
      state: "Oklahoma",
      country: "USA",
      zipCode: "73069",
    });
  });

  it("stores the key on the server and never sends it back", async () => {
    crmNetwork.resolve = async () => ["8.8.8.8"];
    const cookie = await session();
    const saved = await writeSettings(
      new Request("http://localhost/api/crm/settings", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ provider: "jobnimbus", secret: apiKey, recordType: "Customer", statusName: "Lead" }),
      }),
    );
    const body = await saved.json();
    expect(saved.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain(apiKey);
    expect(body).toMatchObject({ provider: "jobnimbus", configured: true, recordType: "Customer", statusName: "Lead" });
    const again = await readSettings(new Request("http://localhost/api/crm/settings", { headers: { cookie } }));
    expect(JSON.stringify(await again.json())).not.toContain(apiKey);
    const locked = await readSettings(new Request("http://localhost/api/crm/settings"));
    expect(locked.status).toBe(401);
  });

  it("tests JobNimbus and posts only Lead pins to a webhook", async () => {
    crmNetwork.resolve = async () => ["8.8.8.8"];
    const calls: Array<{ url: string; body: string; method: string }> = [];
    crmNetwork.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? ""), method: init?.method ?? "GET" });
      if (url.includes("nominatim")) {
        return new Response(
          JSON.stringify({
            address: { road: "West Gray Street", city: "Norman", state: "Oklahoma", postcode: "73069", country_code: "us" },
          }),
          { status: 200 },
        );
      }
      if (url.includes("jobnimbus") && (init?.method ?? "GET") === "GET") return new Response("{}", { status: 200 });
      if (url.startsWith(webhook)) return new Response("ok", { status: 200 });
      return new Response(`refused ${apiKey}`, { status: 500 });
    };
    const tested = await testCrm();
    expect(tested).toEqual({ ok: true, message: "Connected to JobNimbus." });
    expect(calls[0]?.url).toContain("https://app.jobnimbus.com/api1/contacts?size=1");
    expect(calls[0]?.body).not.toContain(apiKey);

    const cookie = await session();
    await createPin(
      new Request("http://localhost/api/field/pins", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ lat: 35.2226, lon: -97.4395, status: "lead", note: "Owner asked for a quote" }),
      }),
    );
    await createPin(
      new Request("http://localhost/api/field/pins", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ lat: 35.21, lon: -97.44, status: "away", note: "Not home" }),
      }),
    );
    const switched = await saveCrm({ provider: "webhook", secret: webhook });
    expect(switched.ok).toBe(true);
    if (switched.ok) expect(JSON.stringify(switched.settings)).not.toContain("hooks.zapier.com");
    const sent = await sendLeadRoute(
      new Request("http://localhost/api/crm/leads", { method: "POST", headers: { cookie } }),
    );
    const payload = (await sent.json()) as { message: string };
    expect(sent.status).toBe(200);
    expect(payload.message).toBe("Sent 1 lead.");
    const posted = calls.find((call) => call.url.startsWith(webhook));
    const body = JSON.parse(posted?.body ?? "{}") as { source: string; event: string; leads: Array<{ note: string; street: string }> };
    expect(body.source).toBe("swathline");
    expect(body.event).toBe("leads.sent");
    expect(body.leads).toHaveLength(1);
    expect(body.leads[0]?.note).toBe("Owner asked for a quote");
    expect(body.leads[0]?.street).toBe("West Gray Street");
    expect(posted?.body).not.toContain("555");
    expect(JSON.stringify(payload)).not.toContain(webhook);
    const shown = publicCrm();
    expect(shown.provider).toBe("webhook");
    expect(shown.lastResult).toBe("Sent 1 lead.");
    expect(shown.lastSentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const read = await readSettings(new Request("http://localhost/api/crm/settings", { headers: { cookie } }));
    const settings = await read.json();
    expect(settings.leadCount).toBe(1);
    expect(settings.lastResult).toBe("Sent 1 lead.");
    expect(JSON.stringify(settings)).not.toContain(apiKey);
    expect(JSON.stringify(settings)).not.toContain(webhook);
  });

  it("tells AccuLynx apart when a lead has no street", async () => {
    crmNetwork.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("nominatim")) return new Response(JSON.stringify({ address: { city: "Norman", state: "Oklahoma" } }), { status: 200 });
      if (url.includes("acculynx.com/api/v2/jobs") && (init?.method ?? "GET") === "GET") return new Response("{}", { status: 200 });
      return new Response("unexpected", { status: 500 });
    };
    const saved = await saveCrm({ provider: "acculynx", secret: apiKey });
    expect(saved.ok).toBe(true);
    const tested = await testRoute(new Request("http://localhost/api/crm/test", { method: "POST", headers: { cookie: await session() } }));
    expect(await tested.json()).toEqual({ message: "Connected to AccuLynx." });
    const result = await sendLeads("alex");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("street");
  });
});
