import { Suspense } from "react";
import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import InviteAccept from "@/components/billing/InviteAccept";

export const metadata: Metadata = {
  title: "Join a team · Swathline",
  description: "Join a Swathline team. You use the plan the owner already pays for. You don't pay separately.",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <AccountChrome title="Join a team">
      <Suspense fallback={null}>
        <InviteAccept token={token} />
      </Suspense>
    </AccountChrome>
  );
}
