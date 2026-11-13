import type { Metadata } from "next";
import AccountChrome from "@/components/auth/AccountChrome";
import PricingBoard from "@/components/billing/PricingBoard";

export const metadata: Metadata = {
  title: "Pricing · Swathline",
  description: "Live hail swaths, storm history, and the sales tools for paintless dent repair. Solo, Crew, and Storm Team each start with a 7-day free trial.",
};

export default function PricingPage() {
  return (
    <AccountChrome title="Pricing" wide>
      <PricingBoard />
    </AccountChrome>
  );
}
