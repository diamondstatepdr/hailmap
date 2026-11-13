import { getAccountByCustomer, getAccountById, updateBilling } from "@/lib/user-accounts";

export interface BillingNotice {
  type: "checkout.completed" | "subscription.updated" | "subscription.deleted" | "payment.failed";
  userId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  priceId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") {
    const id = (value as { id: string }).id.trim();
    return id || null;
  }
  return null;
}

function metadataOf(object: Record<string, unknown>): Record<string, unknown> {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object") return {};
  return metadata as Record<string, unknown>;
}

function priceIdFrom(object: Record<string, unknown>, metadata: Record<string, unknown>): string | null {
  const items = object.items as { data?: Array<{ price?: unknown }> } | undefined;
  const price = items?.data?.[0]?.price;
  const fromItem = idOf(price);
  if (fromItem) return fromItem;
  if (typeof metadata.priceId === "string" && metadata.priceId.trim()) return metadata.priceId.trim();
  return null;
}

/** A $0 trial invoice is payment_status "paid". Prefer the subscription status when Stripe sent it. */
function checkoutStatus(object: Record<string, unknown>): string {
  const subscription = object.subscription;
  if (subscription && typeof subscription === "object" && "status" in subscription) {
    const status = (subscription as { status?: unknown }).status;
    if (typeof status === "string" && status.trim()) return status.trim();
  }
  const paid = object.payment_status === "paid" || object.payment_status === "no_payment_required";
  return paid ? "active" : "incomplete";
}

function periodEnd(object: Record<string, unknown>): string | null {
  const direct = object.current_period_end;
  if (typeof direct === "number" && direct > 0) return new Date(direct * 1000).toISOString();
  const items = object.items as { data?: Array<{ current_period_end?: unknown }> } | undefined;
  const nested = items?.data?.[0]?.current_period_end;
  if (typeof nested === "number" && nested > 0) return new Date(nested * 1000).toISOString();
  return null;
}

export function noticeFromStripeEvent(event: { type: string; data?: { object?: Record<string, unknown> } }): BillingNotice | null {
  const object = event.data?.object ?? {};
  const metadata = metadataOf(object);
  const userId =
    (typeof metadata.userId === "string" && metadata.userId.trim()) ||
    (typeof object.client_reference_id === "string" && object.client_reference_id.trim()) ||
    null;
  const customerId = idOf(object.customer);
  const priceId = priceIdFrom(object, metadata);
  if (event.type === "checkout.session.completed") {
    return {
      type: "checkout.completed",
      userId,
      customerId,
      subscriptionId: idOf(object.subscription),
      priceId,
      status: checkoutStatus(object),
      currentPeriodEnd: null,
    };
  }
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    return {
      type: "subscription.updated",
      userId,
      customerId,
      subscriptionId: typeof object.id === "string" ? object.id : null,
      priceId,
      status: typeof object.status === "string" ? object.status : null,
      currentPeriodEnd: periodEnd(object),
    };
  }
  if (event.type === "customer.subscription.deleted") {
    return {
      type: "subscription.deleted",
      userId,
      customerId,
      subscriptionId: typeof object.id === "string" ? object.id : null,
      priceId,
      status: "canceled",
      currentPeriodEnd: periodEnd(object),
    };
  }
  if (event.type === "invoice.payment_failed") {
    return {
      type: "payment.failed",
      userId,
      customerId,
      subscriptionId: idOf(object.subscription),
      priceId: null,
      status: "past_due",
      currentPeriodEnd: null,
    };
  }
  return null;
}

function keep<T>(value: T | null): T | undefined {
  return value == null ? undefined : value;
}

function resolveUserId(userId: string | null, customerId: string | null): string | null {
  if (userId && getAccountById(userId)) return userId;
  if (customerId) {
    const byCustomer = getAccountByCustomer(customerId);
    if (byCustomer) return byCustomer.id;
  }
  return null;
}

export function applyBillingNotice(notice: BillingNotice): boolean {
  const userId = resolveUserId(notice.userId, notice.customerId);
  if (!userId) return false;
  if (notice.type === "subscription.deleted") {
    updateBilling(userId, {
      stripeCustomerId: keep(notice.customerId),
      stripeSubscriptionId: keep(notice.subscriptionId),
      subscriptionStatus: "canceled",
      subscriptionPriceId: keep(notice.priceId),
      currentPeriodEnd: notice.currentPeriodEnd,
    });
    return true;
  }
  if (notice.type === "payment.failed") {
    updateBilling(userId, {
      stripeCustomerId: keep(notice.customerId),
      stripeSubscriptionId: keep(notice.subscriptionId),
      subscriptionStatus: "past_due",
    });
    return true;
  }
  if (!notice.status) return false;
  const current = getAccountById(userId);
  // Checkout's $0 trial invoice looks paid. Don't replace a trial the subscription event already recorded.
  const status =
    notice.type === "checkout.completed" &&
    current?.subscriptionStatus === "trialing" &&
    (notice.status === "active" || notice.status === "incomplete")
      ? "trialing"
      : notice.status;
  updateBilling(userId, {
    stripeCustomerId: keep(notice.customerId),
    stripeSubscriptionId: keep(notice.subscriptionId),
    subscriptionStatus: status,
    subscriptionPriceId: keep(notice.priceId),
    currentPeriodEnd: notice.currentPeriodEnd,
  });
  return true;
}
