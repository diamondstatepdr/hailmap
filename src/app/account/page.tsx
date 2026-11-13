import { Suspense } from "react";
import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import AccountPanel from "@/components/billing/AccountPanel";

export const metadata: Metadata = {
  title: "Account · Swathline",
  description: "Your Swathline account and subscription.",
};

export default function AccountPage() {
  return (
    <AccountChrome title="Account">
      <Suspense fallback={null}>
        <AccountPanel />
      </Suspense>
    </AccountChrome>
  );
}
