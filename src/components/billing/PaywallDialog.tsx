"use client";

import Link from "next/link";
import { SALES_TOOLS } from "@/lib/billing";
import { LogoMark } from "@/components/brand/Logo";

interface Props {
  onClose: () => void;
  onTeamPasscode: () => void;
}

export default function PaywallDialog({ onClose, onTeamPasscode }: Props) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center">
      <section className="page-enter w-full max-w-md rounded-3xl border border-line bg-panel p-5 shadow-float" data-paywall>
        <div className="flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">This is a sales tool</h2>
            <p className="text-xs text-muted">Solo is the plan for one person</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          The live hail map stays free. These tools need an active subscription. Start with Solo, or pick a crew plan if you are pricing a team.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-1.5 text-sm">
          {SALES_TOOLS.map((tool) => (
            <li key={tool} className="rounded-xl bg-app px-2.5 py-1.5">
              {tool}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-col gap-2">
          <Link href="/pricing" className="btn btn-primary press w-full">
            See Solo and crew plans
          </Link>
          <Link href="/login?next=/pricing" className="btn btn-secondary press w-full">
            Sign in
          </Link>
          <button type="button" className="btn btn-ghost press w-full" onClick={onTeamPasscode}>
            Use the team passcode
          </button>
          <button type="button" className="text-sm font-semibold text-muted" onClick={onClose}>
            Back to the map
          </button>
        </div>
      </section>
    </div>
  );
}
