import type { SessionUser } from "@/lib/auth";
import { billingSnapshot, subscriptionGrantsAccess, type TeamPayer } from "@/lib/billing";
import { teamPayer } from "@/lib/team-store";
import { getAccountById, type AccountRow } from "@/lib/user-accounts";

export function billingContext(user: SessionUser | null): {
  account: AccountRow | null;
  billing: ReturnType<typeof billingSnapshot>;
} {
  const account = user?.role === "member" ? getAccountById(user.id) : null;
  let payer: TeamPayer | null = null;
  if (user?.role === "member" && !subscriptionGrantsAccess(account?.subscriptionStatus)) {
    const owner = teamPayer(user.id);
    if (owner) {
      payer = {
        name: owner.name,
        subscriptionStatus: owner.subscriptionStatus,
        subscriptionPriceId: owner.subscriptionPriceId,
      };
    }
  }
  return { account, billing: billingSnapshot(user, account, payer) };
}
