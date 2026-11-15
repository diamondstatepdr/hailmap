import { Suspense } from "react";
import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import SignupForm from "@/components/auth/SignupForm";

export const metadata: Metadata = {
  title: "Create account · Swathline",
  description:
    "Create a Swathline account. Solo is one person, Crew is up to 5 people, and Storm Team is up to 15 people. Each plan starts with a 7-day free trial.",
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
