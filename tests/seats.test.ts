import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GET as sessionGet } from "@/app/api/auth/session/route";
import { POST as canvassPost, GET as canvassGet } from "@/app/api/canvass/route";
import { GET as honey } from "@/app/api/honey/route";
import { GET as leadsGet } from "@/app/api/leads/route";
import { DELETE as revokeInvite } from "@/app/api/team/invites/[id]/route";
import { GET as joinGet, POST as joinPost } from "@/app/api/team/join/[token]/route";
import { DELETE as removeMember } from "@/app/api/team/members/[id]/route";
import { GET as teamGet, POST as teamPost } from "@/app/api/team/route";
import { sessionCookie, signSession } from "@/lib/auth";
import { seatCapForTier } from "@/lib/seats";
import { createAccount, getAccountByEmail, updateBilling } from "@/lib/user-accounts";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-seats-"));
process.env.HAILMAP_DATA_DIR = dataDir;
process.env.HAILMAP_AUTH_SECRET = "test-secret-key-with-enough-length";
process.env.HAILMAP_TEAM_PASSCODE = "team-pass";
process.env.STRIPE_SECRET_KEY = "sk_test_seats";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_seats";
process.env.STRIPE_PRICE_SOLO = "price_solo";
process.env.STRIPE_PRICE_CREW = "price_crew";
process.env.STRIPE_PRICE_STORM = "price_storm";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function cookieHeader(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

async function signUp(name: string, email: string): Promise<string> {
  const account = await createAccount({ name, email, password: "correct horse battery" });
  expect(account).toBeTruthy();
  return cookieHeader(
    sessionCookie(signSession({ id: account!.id, name: account!.name, role: "member", email: account!.email })),
  );
}

function subscribe(email: string, price: string, status = "active") {
  const account = getAccountByEmail(email);
  expect(account).toBeTruthy();
  updateBilling(account!.id, {
    stripeCustomerId: `cus_${account!.id}`,
    stripeSubscriptionId: `sub_${account!.id}`,
    subscriptionStatus: status,
    subscriptionPriceId: price,
    currentPeriodEnd: "2026-12-01T00:00:00.000Z",
  });
}

async function invite(cookie: string, email: string) {
  return teamPost(
    new Request("http://localhost/api/team", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ email }),
    }),
  );
}

function tokenFrom(url: string): string {
  return new URL(url).pathname.split("/").pop() ?? "";
}

async function salesOpen(cookie: string): Promise<boolean> {
  const response = await honey(new Request("http://localhost/api/honey", { headers: { cookie } }));
  return response.status !== 401 && response.status !== 402;
}

describe("seat caps", () => {
  it("counts Solo as 1 person, Crew as 5, and Storm Team as 15", () => {
    expect(seatCapForTier("solo")).toBe(1);
    expect(seatCapForTier("crew")).toBe(5);
    expect(seatCapForTier("storm")).toBe(15);
    expect(seatCapForTier(null)).toBe(1);
    expect(seatCapForTier("other")).toBe(1);
  });
});

describe("team invites", () => {
  it("blocks Solo, fills Crew, and lets Storm Team stop at 15", async () => {
    const solo = await signUp("Solo Tech", "solo@example.com");
    subscribe("solo@example.com", "price_solo");
    const soloInvite = await invite(solo, "friend@example.com");
    expect(soloInvite.status).toBe(403);
    const soloBody = (await soloInvite.json()) as { error: string };
    expect(soloBody.error).toMatch(/Solo is one person/);
    expect(soloBody.error).toMatch(/up to 5 people/i);
    expect(soloBody.error).toMatch(/up to 15 people/i);

    const crew = await signUp("Crew Lead", "crew@example.com");
    subscribe("crew@example.com", "price_crew");
    const urls: string[] = [];
    for (let n = 0; n < 4; n += 1) {
      const created = await invite(crew, `crew-mate-${n}@example.com`);
      expect(created.status).toBe(201);
      const body = (await created.json()) as { invite: { url: string; email: string } };
      expect(body.invite.email).toBe(`crew-mate-${n}@example.com`);
      expect(body.invite.url).toContain("/invite/");
      urls.push(body.invite.url);
    }
    const again = await invite(crew, "Crew-Mate-0@example.com");
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as { invite: { url: string } };
    expect(againBody.invite.url).toBe(urls[0]);

    const full = await invite(crew, "one-more@example.com");
    expect(full.status).toBe(403);

    const storm = await signUp("Storm Lead", "storm@example.com");
    subscribe("storm@example.com", "price_storm");
    for (let n = 0; n < 14; n += 1) {
      const created = await invite(storm, `storm-mate-${n}@example.com`);
      expect(created.status).toBe(201);
    }
    const stormFull = await invite(storm, "storm-extra@example.com");
    expect(stormFull.status).toBe(403);
  });

  it("lets an invited person use the owner's plan and shares the crew canvass", async () => {
    const ownerCookie = await signUp("Jordan Tech", "jordan@example.com");
    subscribe("jordan@example.com", "price_crew", "trialing");
    const created = await invite(ownerCookie, "sam@example.com");
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { invite: { id: string; url: string } };
    const token = tokenFrom(createdBody.invite.url);

    const preview = await joinGet(new Request(`http://localhost/api/team/join/${token}`), {
      params: Promise.resolve({ token }),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { email: string; ownerName: string; planName: string; status: string };
    expect(previewBody).toMatchObject({
      email: "sam@example.com",
      ownerName: "Jordan Tech",
      planName: "Crew",
      status: "open",
    });

    const strangerCookie = await signUp("Stranger Tech", "stranger@example.com");
    const wrong = await joinPost(new Request(`http://localhost/api/team/join/${token}`, { method: "POST", headers: { cookie: strangerCookie } }), {
      params: Promise.resolve({ token }),
    });
    expect(wrong.status).toBe(403);

    const mateCookie = await signUp("Sam Tech", "sam@example.com");
    expect(await salesOpen(mateCookie)).toBe(false);
    const joined = await joinPost(new Request(`http://localhost/api/team/join/${token}`, { method: "POST", headers: { cookie: mateCookie } }), {
      params: Promise.resolve({ token }),
    });
    expect(joined.status).toBe(200);
    expect(await salesOpen(mateCookie)).toBe(true);

    const session = await sessionGet(new Request("http://localhost/api/auth/session", { headers: { cookie: mateCookie } }));
    const sessionBody = (await session.json()) as {
      billing: { access: boolean; tierName: string | null; viaTeam: { ownerName: string } | null };
    };
    expect(sessionBody.billing.access).toBe(true);
    expect(sessionBody.billing.tierName).toBe("Crew");
    expect(sessionBody.billing.viaTeam?.ownerName).toBe("Jordan Tech");

    const marked = await canvassPost(
      new Request("http://localhost/api/canvass", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ address: "123 Main St, Norman, OK", lat: 35.22, lon: -97.44, status: "interested", note: "Roof" }),
      }),
    );
    expect(marked.status).toBe(200);
    const mateStops = await canvassGet(new Request("http://localhost/api/canvass", { headers: { cookie: mateCookie } }));
    const mateBody = (await mateStops.json()) as { stops: Array<{ address: string }> };
    expect(mateBody.stops.some((stop) => stop.address.includes("123 Main"))).toBe(true);
    const mateLeads = await leadsGet(new Request("http://localhost/api/leads", { headers: { cookie: mateCookie } }));
    const leadsBody = (await mateLeads.json()) as { leads: Array<{ address: string }> };
    expect(leadsBody.leads.some((lead) => lead.address.includes("123 Main"))).toBe(true);

    subscribe("stranger@example.com", "price_solo");
    const strangerStops = await canvassGet(new Request("http://localhost/api/canvass", { headers: { cookie: strangerCookie } }));
    const strangerBody = (await strangerStops.json()) as { stops: Array<{ address: string }> };
    expect(strangerBody.stops.some((stop) => stop.address.includes("123 Main"))).toBe(false);

    const ownPlan = await signUp("Paid Tech", "paid@example.com");
    subscribe("paid@example.com", "price_solo");
    const blocked = await invite(ownerCookie, "paid@example.com");
    expect(blocked.status).toBe(409);
    expect(ownPlan).toContain("hailmap_session=");

    subscribe("jordan@example.com", "price_crew", "canceled");
    expect(await salesOpen(mateCookie)).toBe(false);
    expect(await salesOpen(ownerCookie)).toBe(false);
    const ended = await sessionGet(new Request("http://localhost/api/auth/session", { headers: { cookie: mateCookie } }));
    const endedBody = (await ended.json()) as { billing: { access: boolean; viaTeam: { ownerName: string } | null } };
    expect(endedBody.billing.access).toBe(false);
    expect(endedBody.billing.viaTeam).toBeNull();

    subscribe("jordan@example.com", "price_crew", "active");
    expect(await salesOpen(mateCookie)).toBe(true);
  });

  it("keeps people after a downgrade, blocks new invites, and drops access when someone is removed", async () => {
    const ownerCookie = await signUp("Avery Lead", "avery@example.com");
    subscribe("avery@example.com", "price_crew");
    const mates: string[] = [];
    for (const email of ["a@example.com", "b@example.com", "c@example.com", "d@example.com"]) {
      const created = await invite(ownerCookie, email);
      expect(created.status).toBe(201);
      const body = (await created.json()) as { invite: { url: string } };
      const token = tokenFrom(body.invite.url);
      const cookie = await signUp(email.slice(0, 1).toUpperCase() + " Mate", email);
      const joined = await joinPost(new Request(`http://localhost/api/team/join/${token}`, { method: "POST", headers: { cookie } }), {
        params: Promise.resolve({ token }),
      });
      expect(joined.status).toBe(200);
      mates.push(cookie);
    }

    subscribe("avery@example.com", "price_solo");
    const team = await teamGet(new Request("http://localhost/api/team", { headers: { cookie: ownerCookie } }));
    const teamBody = (await team.json()) as {
      people: number;
      cap: number;
      overCap: boolean;
      canInvite: boolean;
      notice: string;
      members: Array<{ id: string; email: string }>;
    };
    expect(teamBody.people).toBe(5);
    expect(teamBody.cap).toBe(1);
    expect(teamBody.members).toHaveLength(4);
    expect(teamBody.overCap).toBe(true);
    expect(teamBody.canInvite).toBe(false);
    expect(teamBody.notice).toMatch(/Nobody was removed/);
    const extra = await invite(ownerCookie, "e@example.com");
    expect(extra.status).toBe(403);
    expect(await salesOpen(mates[0]!)).toBe(true);

    const removed = await removeMember(
      new Request("http://localhost/api/team/members/" + teamBody.members[0]!.id, {
        method: "DELETE",
        headers: { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ id: teamBody.members[0]!.id }) },
    );
    expect(removed.status).toBe(200);
    expect(await salesOpen(mates[0]!)).toBe(false);
    expect(await salesOpen(mates[1]!)).toBe(true);

    const open = await invite(ownerCookie, "still-waiting@example.com");
    expect(open.status).toBe(403);
    const waiting = await invite(await signUp("Storm Two", "storm-two@example.com"), "unused@example.com");
    expect(waiting.status).toBe(403);

    const crewAgain = await signUp("Blake Lead", "blake@example.com");
    subscribe("blake@example.com", "price_crew");
    const pending = await invite(crewAgain, "pending@example.com");
    const pendingBody = (await pending.json()) as { invite: { id: string; url: string } };
    const revoked = await revokeInvite(
      new Request("http://localhost/api/team/invites/" + pendingBody.invite.id, {
        method: "DELETE",
        headers: { cookie: crewAgain },
      }),
      { params: Promise.resolve({ id: pendingBody.invite.id }) },
    );
    expect(revoked.status).toBe(200);
    const token = tokenFrom(pendingBody.invite.url);
    const dead = await joinGet(new Request(`http://localhost/api/team/join/${token}`), { params: Promise.resolve({ token }) });
    const deadBody = (await dead.json()) as { status: string };
    expect(deadBody.status).toBe("revoked");
    const replacement = await invite(crewAgain, "replacement@example.com");
    expect(replacement.status).toBe(201);
  });
});
