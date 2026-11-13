import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import PricingBoard from "@/components/billing/PricingBoard";

export const metadata: Metadata = {
  title: "Pricing · Swathline",
  description: "Solo is the Swathline plan for one tech. Crew and Storm Team are priced for a crew.",
};

export default function PricingPage() {
  return (
    <AccountChrome title="Pricing" wide>
      <PricingBoard />
    </AccountChrome>
  );
}
