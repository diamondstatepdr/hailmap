export const PAYWALL_EVENT = "swathline-paywall";

export function requestPaywall() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PAYWALL_EVENT));
}

export function subscriptionRequired(status: number, payload: { code?: string } | null | undefined): boolean {
  return status === 402 || payload?.code === "subscription_required";
}
