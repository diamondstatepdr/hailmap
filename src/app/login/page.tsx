import { Suspense } from "react";
import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in · Swathline",
  description: "Sign in to Swathline with your email and password.",
};

export default function LoginPage() {
  return (
    <AccountChrome title="Sign in">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AccountChrome>
  );
}
