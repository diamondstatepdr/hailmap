import { readSession, type SessionUser } from "@/lib/auth";
import { billingEnabled, subscriptionGrantsAccess } from "@/lib/billing";
import { getAccountById } from "@/lib/user-accounts";

function denied(status: 401 | 402, error: string): Response {
  return Response.json({ error, code: "subscription_required" }, { status });
}

/**
 * When billing is off this returns null and the route behaves as it does today.
 * The team-passcode session (role owner) is the admin override.
 */
export function salesDenied(user: SessionUser | null): Response | null {
  if (!billingEnabled()) return null;
  if (!user) return denied(401, "Sign in to use this sales tool.");
  if (user.role !== "member") return null;
  const account = getAccountById(user.id);
  if (subscriptionGrantsAccess(account?.subscriptionStatus)) return null;
  return denied(402, "Subscribe to use this sales tool.");
}

export function gateSales(request: Request): Response | null {
  if (!billingEnabled()) return null;
  return salesDenied(readSession(request));
}
