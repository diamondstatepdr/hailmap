import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { POST as webhook } from "@/app/api/billing/webhook/route";
import { POST as teamPost } from "@/app/api/team/route";
import { sessionCookie, signSession } from "@/lib/auth";
import { inviteEmail, trialEndingEmail } from "@/lib/mail-copy";
import { sendMail } from "@/lib/mail";
import { createAccount, getAccountByEmail, updateBilling } from "@/lib/user-accounts";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-mail-"));
process.env.HAILMAP_DATA_DIR = dataDir;
process.env.HAILMAP_AUTH_SECRET = "test-secret-key-with-enough-length";
process.env.HAILMAP_TEAM_PASSCODE = "team-pass";
process.env.HAILMAP_PUBLIC_URL = "https://swathline.app";
process.env.STRIPE_SECRET_KEY = "sk_test_mail";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_mail";
process.env.STRIPE_PRICE_SOLO = "price_solo";
process.env.STRIPE_PRICE_CREW = "price_crew";
process.env.STRIPE_PRICE_STORM = "price_storm";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

function callsOf(fetchMock: ReturnType<typeof vi.fn>): Array<{ url: string; body: Record<string, unknown>; auth: string }> {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    return {
      url: String(call[0]),
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      auth: String((init.headers as Record<string, string>).Authorization ?? ""),
    };
  });
}

describe("outbound mail", () => {
  it("does not call Resend when the key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendMail({
      to: "tech@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    expect(result).toEqual({ sent: false, retry: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the Resend API and stays quiet when the request fails", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM = "Swathline <hello@swathline.app>";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sent = await sendMail({
      to: "tech@example.com",
      subject: "Join the crew",
      html: "<p>Join</p>",
      text: "Join",
    });
    expect(sent.sent).toBe(true);
    const [call] = callsOf(fetchMock);
    expect(call?.url).toBe("https://api.resend.com/emails");
    expect(call?.auth).toBe("Bearer re_test_key");
    expect(call?.body).toMatchObject({
      from: "Swathline <hello@swathline.app>",
      to: ["tech@example.com"],
      subject: "Join the crew",
      html: "<p>Join</p>",
      text: "Join",
    });

    fetchMock.mockResolvedValueOnce(new Response("no", { status: 403 }));
    const rejected = await sendMail({ to: "tech@example.com", subject: "Join", html: "<p>Join</p>", text: "Join" });
    expect(rejected).toEqual({ sent: false, retry: false });

    fetchMock.mockRejectedValueOnce(new Error("network"));
    const offline = await sendMail({ to: "tech@example.com", subject: "Join", html: "<p>Join</p>", text: "Join" });
    expect(offline).toEqual({ sent: false, retry: true });
  });
});

describe("email copy", () => {
  it("writes a plain invite with the join link", () => {
    const mail = inviteEmail({
      to: "mate@example.com",
      ownerName: "Alex Tech",
      planName: "Crew",
      joinUrl: "https://swathline.app/invite/tok_123",
    });
    expect(mail.to).toBe("mate@example.com");
    expect(mail.subject).toMatch(/Swathline/i);
    expect(mail.text).toContain("Alex Tech");
    expect(mail.text).toContain("Crew");
    expect(mail.text).toContain("https://swathline.app/invite/tok_123");
    expect(mail.html).toContain("https://swathline.app/invite/tok_123");
    expect(mail.html).toContain("Alex Tech");
    expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/amazing|unlock|don't miss|act now|hurry/i);
  });

  it("writes a plain trial reminder with the end date and the account link", () => {
    const mail = trialEndingEmail({
      to: "jordan@example.com",
      name: "Jordan Tech",
      planName: "Solo",
      trialEnd: "2026-11-17T18:00:00.000Z",
      accountUrl: "https://swathline.app/account",
    });
    expect(mail.subject).toMatch(/trial/i);
    expect(mail.text).toContain("Jordan");
    expect(mail.text).toContain("Solo");
    expect(mail.text).toContain("November 17");
    expect(mail.text).toContain("https://swathline.app/account");
    expect(mail.html).toContain("https://swathline.app/account");
    expect(mail.html).toContain("November 17");
    expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/amazing|unlock|don't miss|act now|hurry/i);
  });
});

describe("invite and trial delivery", () => {
  it("emails a new teammate and still returns the copyable link when Resend is off", async () => {
    const account = await createAccount({ name: "Crew Lead", email: "mail-crew@example.com", password: "correct horse battery" });
    expect(account).toBeTruthy();
    updateBilling(account!.id, {
      stripeCustomerId: "cus_mail_crew",
      stripeSubscriptionId: "sub_mail_crew",
      subscriptionStatus: "active",
      subscriptionPriceId: "price_crew",
      currentPeriodEnd: "2026-12-01T00:00:00.000Z",
    });
    const cookie = sessionCookie(signSession({ id: account!.id, name: account!.name, role: "member", email: account!.email })).split(";")[0];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const quiet = await teamPost(
      new Request("http://localhost/api/team", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ email: "mate@example.com" }),
      }),
    );
    expect(quiet.status).toBe(201);
    const quietBody = (await quiet.json()) as { invite: { url: string; email: string }; emailed: boolean };
    expect(quietBody.emailed).toBe(false);
    expect(quietBody.invite.email).toBe("mate@example.com");
    expect(quietBody.invite.url).toContain("https://swathline.app/invite/");
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.RESEND_API_KEY = "re_test_key";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "email_invite" }), { status: 200 }));
    const sent = await teamPost(
      new Request("http://localhost/api/team", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ email: "second@example.com" }),
      }),
    );
    expect(sent.status).toBe(201);
    const sentBody = (await sent.json()) as { invite: { url: string }; emailed: boolean };
    expect(sentBody.emailed).toBe(true);
    expect(sentBody.invite.url).toContain("/invite/");
    const [call] = callsOf(fetchMock);
    expect(call?.body.to).toEqual(["second@example.com"]);
    expect(String(call?.body.html)).toContain(sentBody.invite.url);
    expect(String(call?.body.text)).toContain("Crew Lead");
  });

  it("sends the trial reminder once from trial_will_end and leaves the subscription alone", async () => {
    const account = await createAccount({ name: "Jordan Tech", email: "jordan-trial@example.com", password: "correct horse battery" });
    expect(account).toBeTruthy();
    updateBilling(account!.id, {
      stripeCustomerId: "cus_jordan_trial",
      stripeSubscriptionId: "sub_jordan_trial",
      subscriptionStatus: "trialing",
      subscriptionPriceId: "price_solo",
      currentPeriodEnd: "2026-11-17T18:00:00.000Z",
    });
    const stripe = new Stripe("sk_test_mail");
    const payload = JSON.stringify({
      id: "evt_trial_end",
      object: "event",
      type: "customer.subscription.trial_will_end",
      data: {
        object: {
          object: "subscription",
          id: "sub_jordan_trial",
          customer: "cus_jordan_trial",
          status: "trialing",
          trial_end: Math.floor(Date.parse("2026-11-17T18:00:00.000Z") / 1000),
          metadata: { userId: account?.id, priceId: "price_solo" },
          items: { data: [{ price: "price_solo" }] },
        },
      },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_mail" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "email_trial" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const skipped = await webhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(skipped.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAccountByEmail("jordan-trial@example.com")?.subscriptionStatus).toBe("trialing");

    process.env.RESEND_API_KEY = "re_test_key";
    const sent = await webhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(sent.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [call] = callsOf(fetchMock);
    expect(call?.body.to).toEqual(["jordan-trial@example.com"]);
    expect(String(call?.body.text)).toContain("November 17");
    expect(String(call?.body.text)).toContain("https://swathline.app/account");
    expect(getAccountByEmail("jordan-trial@example.com")?.subscriptionStatus).toBe("trialing");

    const again = await webhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(again.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
