import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/canvass/route";
import { GET as statsGet } from "@/app/api/canvass/stats/route";
import { POST as signIn } from "@/app/api/auth/session/route";
import {
  addressKey,
  CANVASS_COLORS,
  canvassFrame,
  canvassStatusLabel,
  matchStop,
  summarizeReps,
  zonedDayRange,
  type CanvassStop,
} from "@/lib/canvass";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-canvass-"));
process.env.HAILMAP_DATA_DIR = dataDir;
process.env.HAILMAP_TEAM_PASSCODE = "team-pass";
process.env.HAILMAP_AUTH_SECRET = "test-secret-key";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function login(name: string) {
  const response = await signIn(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, passcode: "team-pass" }),
    }),
  );
  expect(response.status).toBe(200);
  return cookieFrom(response);
}

describe("canvass keys and daily counts", () => {
  it("normalizes a street and keeps coordinates on a rounded point", () => {
    expect(addressKey("  3500   W 7th St ", 32.75, -97.33)).toBe("addr:3500 w 7th st");
    expect(addressKey("West 7th Street", 32.75119, -97.33084)).toBe("geo:32.7512,-97.3308");
    expect(addressKey("32.75000, -97.33000", 32.75119, -97.33084)).toBe("geo:32.7512,-97.3308");
    expect(canvassStatusLabel("not_home")).toBe("Not home");
    expect(CANVASS_COLORS.signed).toBe("#047857");
  });

  it("frames the selected neighborhood and leaves a distant city out", () => {
    const frame = canvassFrame({ lat: 33.4152, lon: -111.8324 }, [
      { lat: 33.4148, lon: -111.8648 },
      { lat: 33.4082, lon: -111.7661 },
      { lat: 33.4152, lon: -111.7937 },
      { lat: 33.4152, lon: -111.8324 },
      { lat: 32.75, lon: -97.33 },
    ]);
    expect(frame.west).toBeLessThan(-111.864);
    expect(frame.east).toBeGreaterThan(-111.766);
    expect(frame.south).toBeLessThan(33.408);
    expect(frame.north).toBeGreaterThan(33.415);
    expect(frame.west).toBeGreaterThan(-112.05);
    expect(frame.east).toBeLessThan(-111.6);
  });

  it("treats the same porch as one house and leaves the next block alone", () => {
    const stops = [
      { id: "a", addressKey: "addr:3500 w 7th st", lat: 32.75, lon: -97.33 },
    ];
    expect(matchStop(stops, { addressKey: "addr:3500 w 7th st", lat: 32.751, lon: -97.331 })?.id).toBe("a");
    expect(matchStop(stops, { addressKey: "addr:other", lat: 32.7502, lon: -97.3301 })?.id).toBe("a");
    expect(matchStop(stops, { addressKey: "addr:other", lat: 32.756, lon: -97.34 })).toBeNull();
  });

  it("counts each house once under the last status that rep set", () => {
    const counts = summarizeReps([
      { stopId: "h1", repId: "alex", repName: "Alex", status: "knocked", createdAt: "2026-04-25T15:00:00.000Z" },
      { stopId: "h1", repId: "alex", repName: "Alex", status: "interested", createdAt: "2026-04-25T16:00:00.000Z" },
      { stopId: "h2", repId: "alex", repName: "Alex", status: "signed", createdAt: "2026-04-25T17:00:00.000Z" },
      { stopId: "h3", repId: "blake", repName: "Blake", status: "not_home", createdAt: "2026-04-25T18:00:00.000Z" },
    ]);
    expect(counts[0]).toMatchObject({ repName: "Alex", interested: 1, signed: 1, knocked: 0, total: 2 });
    expect(counts[1]).toMatchObject({ repName: "Blake", notHome: 1, total: 1 });
  });

  it("uses local midnights, including daylight time", () => {
    const summer = zonedDayRange("2026-06-15", "America/Chicago");
    const winter = zonedDayRange("2026-01-15", "America/Chicago");
    expect(summer?.start.toISOString()).toBe("2026-06-15T05:00:00.000Z");
    expect(summer?.end.toISOString()).toBe("2026-06-16T05:00:00.000Z");
    expect(winter?.start.toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(zonedDayRange("04-25-2026", "America/Chicago")).toBeNull();
    expect(zonedDayRange("2026-04-25", "Not/AZone")).toBeNull();
  });
});

describe("canvass API", () => {
  it("shares marks across the team and keeps a daily count per rep", async () => {
    const denied = await GET(new Request("http://localhost/api/canvass"));
    expect(denied.status).toBe(401);

    const alex = await login("Alex");
    const blake = await login("Blake");
    const created = await POST(
      new Request("http://localhost/api/canvass", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alex },
        body: JSON.stringify({
          address: "3500 W 7th St, Fort Worth",
          lat: 32.7501,
          lon: -97.3302,
          status: "knocked",
          note: "  Left a card  ",
          hailIn: 1.75,
        }),
      }),
    );
    expect(created.status).toBe(200);
    const first = (await created.json()) as { stop: CanvassStop };
    expect(first.stop.note).toBe("Left a card");
    expect(first.stop.hailIn).toBe(1.75);
    expect(first.stop.repName).toBe("Alex");

    const shared = await GET(new Request("http://localhost/api/canvass", { headers: { cookie: blake } }));
    const sharedBody = (await shared.json()) as { stops: CanvassStop[] };
    expect(sharedBody.stops).toHaveLength(1);
    expect(sharedBody.stops[0].status).toBe("knocked");

    const updated = await POST(
      new Request("http://localhost/api/canvass", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: blake },
        body: JSON.stringify({
          address: "3500 W 7th St, Fort Worth",
          lat: 32.75012,
          lon: -97.33022,
          status: "signed",
          note: "Signed the roof",
        }),
      }),
    );
    const second = (await updated.json()) as { stop: CanvassStop };
    expect(second.stop.id).toBe(first.stop.id);
    expect(second.stop.status).toBe("signed");
    expect(second.stop.repName).toBe("Blake");
    expect(second.stop.hailIn).toBe(1.75);

    const bad = await POST(
      new Request("http://localhost/api/canvass", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alex },
        body: JSON.stringify({ address: "No status", lat: 32.75, lon: -97.33, status: "maybe" }),
      }),
    );
    expect(bad.status).toBe(400);

    const day = new Date().toISOString().slice(0, 10);
    const stats = await statsGet(
      new Request(`http://localhost/api/canvass/stats?day=${day}&tz=UTC`, { headers: { cookie: alex } }),
    );
    const body = (await stats.json()) as {
      counts: Array<{ repName: string; signed: number; knocked: number; total: number }>;
      totals: { total: number; signed: number };
    };
    expect(body.totals.total).toBe(2);
    expect(body.totals.signed).toBe(1);
    expect(body.counts.find((row) => row.repName === "Alex")).toMatchObject({ knocked: 1, total: 1 });
    expect(body.counts.find((row) => row.repName === "Blake")).toMatchObject({ signed: 1, total: 1 });

    const nearby = await POST(
      new Request("http://localhost/api/canvass", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: alex },
        body: JSON.stringify({ address: "32.75010, -97.33020", lat: 32.75015, lon: -97.33025, status: "interested" }),
      }),
    );
    const third = (await nearby.json()) as { stop: CanvassStop };
    expect(third.stop.id).toBe(first.stop.id);
    expect(third.stop.address).toContain("3500");
  });
});
