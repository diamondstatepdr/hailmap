import { tierForPrice } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import { trialEndingEmail } from "@/lib/mail-copy";
import { getAccountByCustomer, getAccountById } from "@/lib/user-accounts";

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") {
    const id = (value as { id: string }).id.trim();
    return id || null;
  }
  return null;
}

function priceIdFrom(object: Record<string, unknown>, metadata: Record<string, unknown>): string | null {
  const items = object.items as { data?: Array<{ price?: unknown }> } | undefined;
  const fromItem = idOf(items?.data?.[0]?.price);
  if (fromItem) return fromItem;
  if (typeof metadata.priceId === "string" && metadata.priceId.trim()) return metadata.priceId.trim();
  return null;
}

function alreadySent(key: string): boolean {
  const row = getDb().prepare(`SELECT 1 AS n FROM mail_sends WHERE dedupe_key = ?`).get(key);
  return Boolean(row);
}

function recordSend(key: string): void {
  getDb()
    .prepare(`INSERT OR IGNORE INTO mail_sends (dedupe_key, kind, sent_at) VALUES (?, 'trial_will_end', ?)`)
    .run(key, new Date().toISOString());
}

/**
 * Stripe sends customer.subscription.trial_will_end three days before the trial ends.
 * A missing Resend key, or a customer we don't know, leaves the webhook successful.
 * A network failure asks Stripe to retry. A second delivery of the same subscription does not send again.
 */
export async function deliverTrialReminder(
  event: { type: string; data?: { object?: Record<string, unknown> } },
  origin: string,
): Promise<"skipped" | "sent" | "failed" | "duplicate"> {
  if (event.type !== "customer.subscription.trial_will_end") return "skipped";
  const object = event.data?.object ?? {};
  const subscriptionId = typeof object.id === "string" ? object.id.trim() : "";
  if (!subscriptionId) return "skipped";
  const dedupe = `trial_will_end:${subscriptionId}`;
  if (alreadySent(dedupe)) return "duplicate";
  if (!process.env.RESEND_API_KEY?.trim()) return "skipped";

  const metadata =
    object.metadata && typeof object.metadata === "object" ? (object.metadata as Record<string, unknown>) : {};
  const userId = typeof metadata.userId === "string" ? metadata.userId.trim() : "";
  const customerId = idOf(object.customer);
  const account = (userId ? getAccountById(userId) : null) ?? (customerId ? getAccountByCustomer(customerId) : null);
  if (!account?.email) return "skipped";

  const trialEnd =
    typeof object.trial_end === "number" && object.trial_end > 0
      ? new Date(object.trial_end * 1000).toISOString()
      : new Date().toISOString();
  const result = await sendMail(
    trialEndingEmail({
      to: account.email,
      name: account.name,
      planName: tierForPrice(priceIdFrom(object, metadata))?.name ?? "Swathline",
      trialEnd,
      accountUrl: `${origin.replace(/\/$/, "")}/account`,
    }),
  );
  if (!result.sent) return result.retry ? "failed" : "skipped";
  recordSend(dedupe);
  return "sent";
}
