import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { POST as signIn, GET as sessionGet } from "@/app/api/auth/session/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as checkout } from "@/app/api/billing/checkout/route";
import { POST as webhook } from "@/app/api/billing/webhook/route";
import { GET as honey } from "@/app/api/honey/route";
import { POST as createPin } from "@/app/api/field/pins/route";
import { verifySessionToken } from "@/lib/auth";
import { TIERS, TRIAL_DAYS, billingEnabled, canStartTrial, formatPlanAmount, subscriptionGrantsAccess } from "@/lib/billing";
import { applyBillingNotice, noticeFromStripeEvent } from "@/lib/billing-sync";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { getStripe } from "@/lib/stripe-server";
import { createAccount, getAccountByEmail, updateBilling } from "@/lib/user-accounts";

vi.mock("@/lib/stripe-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stripe-server")>("@/lib/stripe-server");
  return {
    getStripe: vi.fn(() => actual.getStripe()),
  };
});

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

  it("keeps a trialing subscription on the sales tools", async () => {
    enableStripe();
    const created = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Avery Tech", email: "avery@example.com", password: "trial password ok" }),
      }),
    );
    expect(created.status).toBe(201);
    const account = getAccountByEmail("avery@example.com");
    const memberCookie = cookieFrom(created);
    const locked = await honey(new Request("http://localhost/api/honey", { headers: { cookie: memberCookie } }));
    expect(locked.status).toBe(402);

    const stripe = new Stripe("sk_test_billing");
    const payload = JSON.stringify({
      id: "evt_trial",
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          object: "subscription",
          id: "sub_avery",
          customer: "cus_avery",
          status: "trialing",
          metadata: { userId: account?.id, priceId: "price_solo", tier: "solo" },
          items: { data: [{ price: "price_solo", current_period_end: 1_800_000_000 }] },
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
    expect(getAccountByEmail("avery@example.com")?.subscriptionStatus).toBe("trialing");
    const open = await honey(new Request("http://localhost/api/honey", { headers: { cookie: memberCookie } }));
    expect(open.status).toBe(400);
    const session = await sessionGet(new Request("http://localhost/api/auth/session", { headers: { cookie: memberCookie } }));
    const body = (await session.json()) as { billing: { access: boolean; status: string | null } };
    expect(body.billing.access).toBe(true);
    expect(body.billing.status).toBe("trialing");
  });
});

describe("free trial", () => {
  afterEach(async () => {
    const actual = await vi.importActual<typeof import("@/lib/stripe-server")>("@/lib/stripe-server");
    vi.mocked(getStripe).mockImplementation(() => actual.getStripe());
  });

  it("offers one 7-day trial and keeps a paid checkout from erasing it", () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(canStartTrial({ subscriptionStatus: null, stripeSubscriptionId: null })).toBe(true);
    expect(canStartTrial({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_old" })).toBe(false);
    expect(canStartTrial({ subscriptionStatus: "trialing", stripeSubscriptionId: "sub_now" })).toBe(false);
    expect(canStartTrial({ subscriptionStatus: null, stripeSubscriptionId: "sub_only" })).toBe(false);
    expect(canStartTrial(null)).toBe(true);

    const started = noticeFromStripeEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "acct_trial",
          customer: "cus_trial",
          payment_status: "paid",
          metadata: { userId: "acct_trial", priceId: "price_solo" },
          subscription: { id: "sub_trial", status: "trialing" },
        },
      },
    });
    expect(started?.status).toBe("trialing");
    expect(started?.subscriptionId).toBe("sub_trial");

    const paidInvoice = noticeFromStripeEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "acct_trial",
          customer: "cus_trial",
          payment_status: "paid",
          subscription: "sub_trial",
          metadata: { priceId: "price_solo" },
        },
      },
    });
    expect(paidInvoice?.status).toBe("active");
  });

  it("starts Checkout with a 7-day trial and a card up front for a new account", async () => {
    enableStripe();
    const created = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Blair Tech", email: "blair@example.com", password: "checkout password ok" }),
      }),
    );
    const create = vi.fn(async () => ({ id: "cs_test_blair", url: "https://checkout.stripe.test/c/cs_test_blair" }));
    const list = vi.fn(async () => ({ data: [] as Array<{ id: string }> }));
    vi.mocked(getStripe).mockReturnValue({
      customers: { create: vi.fn(async () => ({ id: "cus_blair" })) },
      subscriptions: { list },
      checkout: { sessions: { create } },
    } as never);

    const response = await checkout(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieFrom(created) },
        body: JSON.stringify({ tier: "solo" }),
      }),
    );
    expect(response.status).toBe(200);
    const params = create.mock.calls[0]?.[0] as {
      payment_method_collection?: string;
      subscription_data?: { trial_period_days?: number; trial_end?: unknown };
    };
    expect(params.payment_method_collection).toBe("always");
    expect(params.subscription_data?.trial_period_days).toBe(7);
    expect(params.subscription_data?.trial_end).toBeUndefined();
  });

  it("does not give a second trial after a subscription, even if the local row was cleared", async () => {
    enableStripe();
    const created = await signup(
      new Request("http://localhost/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Drew Tech", email: "drew@example.com", password: "second trial no thanks" }),
      }),
    );
    const account = getAccountByEmail("drew@example.com");
    expect(account).toBeTruthy();
    updateBilling(account?.id ?? "", { stripeCustomerId: "cus_drew" });
    const create = vi.fn(async () => ({ id: "cs_test_drew", url: "https://checkout.stripe.test/c/cs_test_drew" }));
    const list = vi.fn(async () => ({ data: [{ id: "sub_drew_old", status: "canceled" }] }));
    vi.mocked(getStripe).mockReturnValue({
      customers: { create: vi.fn(async () => ({ id: "cus_should_not" })) },
      subscriptions: { list },
      checkout: { sessions: { create } },
    } as never);

    const response = await checkout(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieFrom(created) },
        body: JSON.stringify({ tier: "crew" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalled();
    const params = create.mock.calls[0]?.[0] as { subscription_data?: { trial_period_days?: number } };
    expect(params.subscription_data?.trial_period_days).toBeUndefined();

    updateBilling(account?.id ?? "", { subscriptionStatus: "canceled", stripeSubscriptionId: "sub_drew_old" });
    const again = await checkout(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookieFrom(created) },
        body: JSON.stringify({ tier: "storm" }),
      }),
    );
    expect(again.status).toBe(200);
    const second = create.mock.calls[1]?.[0] as { subscription_data?: { trial_period_days?: number } };
    expect(second.subscription_data?.trial_period_days).toBeUndefined();
  });

  it("does not let a later paid checkout event erase a trial", async () => {
    enableStripe();
    const account = await createAccount({ name: "Eden Tech", email: "eden@example.com", password: "keep the trial status" });
    expect(account?.id).toBeTruthy();
    const userId = account?.id;
    applyBillingNotice({
      type: "subscription.updated",
      userId: userId ?? null,
      customerId: "cus_eden",
      subscriptionId: "sub_eden",
      priceId: "price_solo",
      status: "trialing",
      currentPeriodEnd: null,
    });
    applyBillingNotice({
      type: "checkout.completed",
      userId: userId ?? null,
      customerId: "cus_eden",
      subscriptionId: "sub_eden",
      priceId: "price_solo",
      status: "active",
      currentPeriodEnd: null,
    });
    expect(getAccountByEmail("eden@example.com")?.subscriptionStatus).toBe("trialing");
  });
});
