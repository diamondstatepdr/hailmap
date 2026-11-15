import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import PricingBoard from "@/components/billing/PricingBoard";

export const metadata: Metadata = {
  title: "Pricing · Swathline",
  description:
    "Solo is one person, Crew is up to 5 people, and Storm Team is up to 15 people. Same tools on every plan. Each plan starts with a 7-day free trial.",
};

export default function PricingPage() {
  return (
    <AccountChrome title="Pricing" wide>
      <PricingBoard />
    </AccountChrome>
  );
}
