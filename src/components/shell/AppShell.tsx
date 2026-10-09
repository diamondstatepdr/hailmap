"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CloudHail, FileText, House, Map, Moon, Navigation, SunMedium } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/brand/Logo";

export type AppSection = "map" | "storms" | "properties" | "field" | "reports";

const NAV: Array<{ id: AppSection; label: string; hint: string; icon: typeof Map }> = [
  { id: "map", label: "Map", hint: "Live map", icon: Map },
  { id: "storms", label: "Storms", hint: "Report list", icon: CloudHail },
  { id: "properties", label: "Addresses", hint: "Property history", icon: House },
  { id: "field", label: "Field", hint: "Drive mode", icon: Navigation },
  { id: "reports", label: "Reports", hint: "Shareable reports", icon: FileText },
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
      <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-panel md:flex">
        <div className="flex items-center gap-3 px-4 pb-3 pt-5">
          <LogoMark size={40} />
          <Wordmark />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => onSection(item.id)}
                className={`nav-item press ${on ? "nav-item-active" : ""}`}
              >
                <span className="nav-icon">
                  <Icon size={18} strokeWidth={2.1} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold tracking-tight">{item.label}</span>
                  <span className="block text-[11px] text-muted">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="space-y-3 border-t border-line px-3 py-4">
          <div className="theme-seg" role="group" aria-label="Theme">
            <button type="button" aria-pressed={theme === "light"} onClick={() => theme === "dark" && onToggleTheme()}>
              <SunMedium size={14} className="mx-auto mb-0.5" />
              Light
            </button>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => theme === "light" && onToggleTheme()}>
              <Moon size={14} className="mx-auto mb-0.5" />
              Dark
            </button>
          </div>
          {userName ? (
            <button type="button" onClick={onSignOut} className="flex w-full items-center gap-2 rounded-2xl px-1 py-1 text-left">
              <span className="avatar">{userName.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{userName}</span>
                <span className="text-xs text-muted">Sign out</span>
              </span>
            </button>
          ) : (
            <button type="button" onClick={onSignIn} className="btn btn-secondary press w-full flex-col gap-0 py-2">
              Sign in
              <span className="text-[11px] font-medium text-muted">{authConfigured ? "Team passcode" : "Not configured"}</span>
            </button>
          )}
          <Link href="/privacy" className="block px-1 text-xs text-muted hover:text-ink">
            Privacy
          </Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">{children}</div>
        <nav
          className="grid grid-cols-5 border-t border-line bg-panel/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(16,36,56,0.06)] backdrop-blur-md md:hidden"
          aria-label="Sections"
        >
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => onSection(item.id)}
                className="tab-item"
              >
                <span className="tab-icon">
                  <Icon size={18} strokeWidth={on ? 2.35 : 1.85} />
                </span>
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
