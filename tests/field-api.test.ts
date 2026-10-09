import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "@/app/api/auth/session/route";
import { GET as listPins, POST as createPin } from "@/app/api/field/pins/route";
import { GET as geocodeGet } from "@/app/api/geocode/route";
import { GET as placeGet } from "@/app/api/place/route";
import { GET as listWatch, POST as createWatch } from "@/app/api/watch/route";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-field-"));
process.env.HAILMAP_DATA_DIR = dataDir;
process.env.HAILMAP_TEAM_PASSCODE = "team-pass";
process.env.HAILMAP_AUTH_SECRET = "test-secret-key";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function cookieFrom(response: Response): string {
  const raw = response.headers.get("set-cookie") ?? "";
  return raw.split(";")[0];
}

async function signIn(name: string) {
  const response = await POST(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, passcode: "team-pass" }),
    }),
  );
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("team sign-in and private field data", () => {
  it("rejects a bad passcode and keeps field data on the signed-in name", async () => {
    const denied = await POST(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Alex", passcode: "nope" }),
      }),
    );
    expect(denied.status).toBe(401);

    const alex = await signIn("Alex");
    const blake = await signIn("Blake");
    const watch = await createWatch(
      new Request("http://localhost/api/watch", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alex },
        body: JSON.stringify({ label: "Norman shop", query: "Norman, OK", lat: 35.22, lon: -97.44, radiusKm: 10 }),
      }),
    );
    expect(watch.status).toBe(201);

    const other = await listWatch(new Request("http://localhost/api/watch", { headers: { cookie: blake } }));
    const otherBody = (await other.json()) as { places: unknown[] };
    expect(otherBody.places).toEqual([]);

    const pin = await createPin(
      new Request("http://localhost/api/field/pins", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alex },
        body: JSON.stringify({ lat: 35.22, lon: -97.45, status: "lead", note: "Owner asked for a quote" }),
      }),
    );
    expect(pin.status).toBe(201);
    const hidden = await listPins(new Request("http://localhost/api/field/pins", { headers: { cookie: blake } }));
    const hiddenBody = (await hidden.json()) as { pins: unknown[] };
    expect(hiddenBody.pins).toEqual([]);

    const mine = await listPins(new Request("http://localhost/api/field/pins", { headers: { cookie: alex } }));
    const mineBody = (await mine.json()) as { pins: Array<{ note: string }> };
    expect(mineBody.pins[0].note).toBe("Owner asked for a quote");

    const session = await GET(new Request("http://localhost/api/auth/session", { headers: { cookie: alex } }));
    const sessionBody = (await session.json()) as { user: { name: string } };
    expect(sessionBody.user.name).toBe("Alex");

    const signedOut = await DELETE();
    expect(signedOut.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects a place query without coordinates and a short geocode", async () => {
    const place = await placeGet(new Request("http://localhost/api/place"));
    expect(place.status).toBe(400);
    const geocode = await geocodeGet(new Request("http://localhost/api/geocode?q=ab"));
    expect(geocode.status).toBe(400);
    const pins = await listPins(new Request("http://localhost/api/field/pins"));
    expect(pins.status).toBe(401);
  });
});
