import { Suspense } from "react";
import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = {
  title: "Create account · Swathline",
  description: "Create a Swathline account.",
};

export default function SignupPage() {
  return (
    <AccountChrome title="Create account">
      <Suspense fallback={null}>
        <SignupForm />
      </Suspense>
    </AccountChrome>
  );
}
