"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type AppSection = "map" | "storms" | "properties" | "field" | "reports";

const NAV: Array<{ id: AppSection; label: string; hint: string }> = [
  { id: "map", label: "Map", hint: "Live map" },
  { id: "storms", label: "Storms", hint: "Report list" },
  { id: "properties", label: "Addresses", hint: "Property history" },
  { id: "field", label: "Field", hint: "Drive mode" },
  { id: "reports", label: "Reports", hint: "Shareable reports" },
];

interface Props {
  section: AppSection;
  onSection: (section: AppSection) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  userName: string | null;
  authConfigured: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

export default function AppShell({
  section,
  onSection,
  theme,
  onToggleTheme,
  userName,
  authConfigured,
  onSignIn,
  onSignOut,
  children,
}: Props) {
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-app text-ink">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel md:flex">
        <div className="flex items-center gap-3 px-4 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent text-sm font-bold text-accentink">H</span>
          <div>
            <p className="text-base font-semibold leading-tight">HailMap</p>
            <p className="text-xs text-muted">Storm intelligence</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Sections">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => onSection(item.id)}
              className={`rounded-2xl px-3 py-2.5 text-left ${
                section === item.id ? "bg-accent text-accentink" : "hover:bg-app"
              }`}
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className={`block text-xs ${section === item.id ? "text-accentink/80" : "text-muted"}`}>
                {item.hint}
              </span>
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line px-3 py-4">
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-full rounded-2xl border border-line px-3 py-2 text-sm font-medium"
          >
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </button>
          {userName ? (
            <button type="button" onClick={onSignOut} className="w-full rounded-2xl px-3 py-2 text-left text-sm">
              <span className="block font-semibold">{userName}</span>
              <span className="text-xs text-muted">Sign out</span>
            </button>
          ) : (
            <button type="button" onClick={onSignIn} className="w-full rounded-2xl bg-app px-3 py-2 text-left text-sm">
              <span className="block font-semibold">Sign in</span>
              <span className="text-xs text-muted">{authConfigured ? "Team passcode" : "Not configured"}</span>
            </button>
          )}
          <Link href="/privacy" className="block px-3 text-xs text-muted">
            Privacy
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">{children}</div>
        <nav
          className="grid grid-cols-5 border-t border-line bg-panel pb-[max(0.35rem,env(safe-area-inset-bottom))] md:hidden"
          aria-label="Sections"
        >
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={section === item.id ? "page" : undefined}
              onClick={() => onSection(item.id)}
              className={`px-1 py-2 text-center text-[11px] font-semibold ${
                section === item.id ? "text-accent" : "text-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
