import type { Metadata } from "next";
import Link from "next/link";
import AccountChrome from "@/components/auth/AccountChrome";

export const metadata: Metadata = {
  title: "Reset password · Swathline",
  description: "Password reset for a Swathline account.",
};

// Password reset by email is not wired up. There is no free mailer in this deploy.
// TODO: send a one-time reset link when an email provider is available.
export default function ForgotPage() {
  return (
    <AccountChrome title="Reset password">
      <section className="rounded-3xl border border-line bg-panel p-5 shadow-float">
        <h2 className="text-2xl font-semibold tracking-tight">Reset password</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Email reset is not set up yet. Write to{" "}
          <a className="font-semibold text-accent" href="mailto:diamondstatepdr@gmail.com">
            diamondstatepdr@gmail.com
          </a>{" "}
          from the address on the account and ask for a reset.
        </p>
        <Link href="/login" className="btn btn-secondary press mt-5 w-full">
          Back to sign in
        </Link>
      </section>
    </AccountChrome>
  );
}
