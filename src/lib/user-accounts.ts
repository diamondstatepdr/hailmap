import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { normalizeUserName } from "@/lib/auth";
import { hashPassword } from "@/lib/passwords";

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionPriceId: string | null;
  currentPeriodEnd: string | null;
}

interface AccountSql {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  subscription_price_id: string | null;
  current_period_end: string | null;
}

const ACCOUNT_SQL = `id, name, email, password_hash, stripe_customer_id, stripe_subscription_id,
  subscription_status, subscription_price_id, current_period_end`;

function mapAccount(row: AccountSql | undefined): AccountRow | null {
  if (!row?.email || !row.password_hash) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
    subscriptionPriceId: row.subscription_price_id,
    currentPeriodEnd: row.current_period_end,
  };
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export async function createAccount(input: { name: string; email: string; password: string }): Promise<AccountRow | null> {
  const named = normalizeUserName(input.name);
  const email = normalizeEmail(input.email);
  if (!named || !email) return null;
  const id = `acct_${randomUUID()}`;
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);
  try {
    getDb()
      .prepare(
        `INSERT INTO users (id, name, created_at, email, password_hash) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, named.name, now, email, passwordHash);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return null;
    throw error;
  }
  return getAccountById(id);
}

export function getAccountByEmail(email: string): AccountRow | null {
  const row = getDb().prepare(`SELECT ${ACCOUNT_SQL} FROM users WHERE email = ?`).get(email) as AccountSql | undefined;
  return mapAccount(row);
}

export function getAccountById(id: string): AccountRow | null {
  const row = getDb().prepare(`SELECT ${ACCOUNT_SQL} FROM users WHERE id = ?`).get(id) as AccountSql | undefined;
  return mapAccount(row);
}

export function getAccountByCustomer(customerId: string): AccountRow | null {
  const row = getDb()
    .prepare(`SELECT ${ACCOUNT_SQL} FROM users WHERE stripe_customer_id = ?`)
    .get(customerId) as AccountSql | undefined;
  return mapAccount(row);
}

export interface BillingPatch {
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPriceId?: string | null;
  currentPeriodEnd?: string | null;
}

export function updateBilling(userId: string, patch: BillingPatch): AccountRow | null {
  const current = getAccountById(userId);
  if (!current) return null;
  getDb()
    .prepare(
      `UPDATE users SET
         stripe_customer_id = ?,
         stripe_subscription_id = ?,
         subscription_status = ?,
         subscription_price_id = ?,
         current_period_end = ?
       WHERE id = ?`,
    )
    .run(
      patch.stripeCustomerId === undefined ? current.stripeCustomerId : patch.stripeCustomerId,
      patch.stripeSubscriptionId === undefined ? current.stripeSubscriptionId : patch.stripeSubscriptionId,
      patch.subscriptionStatus === undefined ? current.subscriptionStatus : patch.subscriptionStatus,
      patch.subscriptionPriceId === undefined ? current.subscriptionPriceId : patch.subscriptionPriceId,
      patch.currentPeriodEnd === undefined ? current.currentPeriodEnd : patch.currentPeriodEnd,
      userId,
    );
  return getAccountById(userId);
}
