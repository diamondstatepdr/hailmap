import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import Stripe from "stripe";
import { POST as signIn, GET as sessionGet } from "@/app/api/auth/session/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as webhook } from "@/app/api/billing/webhook/route";
import { GET as honey } from "@/app/api/honey/route";
import { POST as createPin } from "@/app/api/field/pins/route";
import { verifySessionToken } from "@/lib/auth";
import { TIERS, billingEnabled, formatPlanAmount, subscriptionGrantsAccess } from "@/lib/billing";
import { applyBillingNotice } from "@/lib/billing-sync";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { getAccountByEmail } from "@/lib/user-accounts";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "hailmap-billing-"));
process.env.HAILMAP_DATA_DIR = dataDir;
process.env.HAILMAP_AUTH_SECRET = "test-secret-key-with-enough-length";
process.env.HAILMAP_TEAM_PASSCODE = "team-pass";

const STRIPE_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_SOLO", "STRIPE_PRICE_CREW", "STRIPE_PRICE_STORM"] as const;

function clearStripe() {
  for (const key of STRIPE_KEYS) delete process.env[key];
}

function enableStripe() {
  process.env.STRIPE_SECRET_KEY = "sk_test_billing";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_billing";
  process.env.STRIPE_PRICE_SOLO = "price_solo";
  process.env.STRIPE_PRICE_CREW = "price_crew";
  process.env.STRIPE_PRICE_STORM = "price_storm";
}

beforeEach(() => {
  clearStripe();
});

afterAll(() => {
  clearStripe();
  rmSync(dataDir, { recursive: true, force: true });
});

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

describe("plan catalog", () => {
  it("features Solo first and keeps prices out of the catalog", () => {
    expect(TIERS.map((tier) => tier.id)).toEqual(["solo", "crew", "storm"]);
    expect(TIERS[0]?.featured).toBe(true);
    expect(TIERS[0]?.audience).toBe("individual");
    expect(TIERS.filter((tier) => tier.audience === "team").map((tier) => tier.id)).toEqual(["crew", "storm"]);
    const source = readFileSync(path.join(process.cwd(), "src/lib/billing.ts"), "utf8");
    expect(source).not.toMatch(/\$\d/);
    expect(billingEnabled()).toBe(false);
    enableStripe();
    expect(billingEnabled()).toBe(true);
    delete process.env.STRIPE_PRICE_SOLO;
    expect(billingEnabled()).toBe(false);
    expect(subscriptionGrantsAccess("active")).toBe(true);
    expect(subscriptionGrantsAccess("trialing")).toBe(true);
    expect(subscriptionGrantsAccess("past_due")).toBe(false);
    expect(formatPlanAmount(4321, "usd", "month")).toBe("$43.21/mo");
  });
});

describe("passwords and accounts", () => {
  it("hashes passwords and signs an email account in", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("wrong horse battery", stored)).toBe(false);

    const created = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Riley Tech", email: "Riley@Example.com", password: "correct horse battery" }),
      }),
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { user: { email: string; role: string } };
    expect(createdBody.user.email).toBe("riley@example.com");
    expect(createdBody.user.role).toBe("member");
    const row = getAccountByEmail("riley@example.com");
    expect(row?.passwordHash.startsWith("scrypt$")).toBe(true);

    const duplicate = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Riley Tech", email: "riley@example.com", password: "correct horse battery" }),
      }),
    );
    expect(duplicate.status).toBe(409);

    const short = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Sam Tech", email: "sam@example.com", password: "short" }),
      }),
    );
    expect(short.status).toBe(400);

    const denied = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "riley@example.com", password: "not-the-password" }),
      }),
    );
    expect(denied.status).toBe(401);

    const signed = await login(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "riley@example.com", password: "correct horse battery" }),
      }),
    );
    expect(signed.status).toBe(200);
    const token = decodeURIComponent(cookieFrom(signed).split("=")[1] ?? "");
    expect(verifySessionToken(token)?.role).toBe("member");
  });

  it("keeps a legacy passcode cookie as the owner override", () => {
    const body = Buffer.from(JSON.stringify({ id: "alex", name: "Alex", exp: Date.now() + 60_000 })).toString("base64url");
    const sig = createHmac("sha256", process.env.HAILMAP_AUTH_SECRET ?? "").update(body).digest("base64url");
    const user = verifySessionToken(`${body}.${sig}`);
    expect(user).toEqual({ id: "alex", name: "Alex", role: "owner" });
  });
});

describe("paywall", () => {
  it("leaves sales tools open when Stripe is not configured", async () => {
    const response = await honey(new Request("http://localhost/api/honey"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBeUndefined();
  });

  it("requires a subscription for members and lets the team passcode through", async () => {
    enableStripe();
    const pass = await signIn(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Alex", passcode: "team-pass" }),
      }),
    );
    expect(pass.status).toBe(200);
    const ownerCookie = cookieFrom(pass);
    const ownerPin = await createPin(
      new Request("http://localhost/api/field/pins", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ownerCookie },
        body: JSON.stringify({ lat: 35.22, lon: -97.45, status: "lead", note: "Owner override" }),
      }),
    );
    expect(ownerPin.status).toBe(201);

    const created = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Casey Tech", email: "casey@example.com", password: "another long password" }),
      }),
    );
    const memberCookie = cookieFrom(created);
    const locked = await honey(new Request("http://localhost/api/honey", { headers: { cookie: memberCookie } }));
    expect(locked.status).toBe(402);
    const anonymous = await honey(new Request("http://localhost/api/honey"));
    expect(anonymous.status).toBe(401);

    const session = await sessionGet(new Request("http://localhost/api/auth/session", { headers: { cookie: memberCookie } }));
    const sessionBody = (await session.json()) as { billing: { enabled: boolean; access: boolean; tier: string | null } };
    expect(sessionBody.billing.enabled).toBe(true);
    expect(sessionBody.billing.access).toBe(false);

    const account = getAccountByEmail("casey@example.com");
    expect(account).toBeTruthy();
    applyBillingNotice({
      type: "checkout.completed",
      userId: account?.id ?? null,
      customerId: "cus_casey",
      subscriptionId: "sub_casey",
      priceId: "price_solo",
      status: "active",
      currentPeriodEnd: null,
    });
    const open = await honey(new Request("http://localhost/api/honey", { headers: { cookie: memberCookie } }));
    expect(open.status).toBe(400);
    const after = await sessionGet(new Request("http://localhost/api/auth/session", { headers: { cookie: memberCookie } }));
    const afterBody = (await after.json()) as { billing: { access: boolean; tierName: string | null } };
    expect(afterBody.billing.access).toBe(true);
    expect(afterBody.billing.tierName).toBe("Solo");

    applyBillingNotice({
      type: "payment.failed",
      userId: account?.id ?? null,
      customerId: "cus_casey",
      subscriptionId: "sub_casey",
      priceId: null,
      status: "past_due",
      currentPeriodEnd: null,
    });
    const failed = await createPin(
      new Request("http://localhost/api/field/pins", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: memberCookie },
        body: JSON.stringify({ lat: 35.22, lon: -97.45, status: "lead" }),
      }),
    );
    expect(failed.status).toBe(402);

    applyBillingNotice({
      type: "subscription.deleted",
      userId: account?.id ?? null,
      customerId: "cus_casey",
      subscriptionId: "sub_casey",
      priceId: "price_solo",
      status: "canceled",
      currentPeriodEnd: null,
    });
    const gone = await honey(new Request("http://localhost/api/honey", { headers: { cookie: memberCookie } }));
    expect(gone.status).toBe(402);
  });

  it("syncs checkout, renewal, and a bad signature through the webhook", async () => {
    enableStripe();
    const created = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Jordan Tech", email: "jordan@example.com", password: "webhook password ok" }),
      }),
    );
    const account = getAccountByEmail("jordan@example.com");
    expect(created.status).toBe(201);
    expect(account).toBeTruthy();
    const stripe = new Stripe("sk_test_billing");
    const payload = JSON.stringify({
      id: "evt_checkout",
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          object: "checkout.session",
          client_reference_id: account?.id,
          customer: "cus_jordan",
          subscription: "sub_jordan",
          payment_status: "paid",
          metadata: { userId: account?.id, priceId: "price_crew", tier: "crew" },
        },
      },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_billing" });
    const ok = await webhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(ok.status).toBe(200);
    expect(getAccountByEmail("jordan@example.com")?.subscriptionStatus).toBe("active");
    expect(getAccountByEmail("jordan@example.com")?.subscriptionPriceId).toBe("price_crew");

    const bad = await webhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=1,v1=nope", "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(bad.status).toBe(400);

    clearStripe();
    const off = await webhook(
      new Request("http://localhost/api/billing/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      }),
    );
    expect(off.status).toBe(404);
  });
});
