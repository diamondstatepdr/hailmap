"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Bell, CloudHail, FileText, House, Map, Moon, Navigation, Palette, SunMedium } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/brand/Logo";

export type AppSection = "map" | "storms" | "properties" | "field" | "reports" | "alerts";

const NAV: Array<{ id: AppSection; label: string; hint: string; icon: typeof Map; tone: string }> = [
  { id: "map", label: "Map", hint: "Live map", icon: Map, tone: "map" },
  { id: "storms", label: "Storms", hint: "Report list", icon: CloudHail, tone: "storms" },
  { id: "properties", label: "Addresses", hint: "Property history", icon: House, tone: "addresses" },
  { id: "field", label: "Field", hint: "Drive mode", icon: Navigation, tone: "field" },
  { id: "reports", label: "Reports", hint: "Shareable reports", icon: FileText, tone: "reports" },
  { id: "alerts", label: "Alerts", hint: "Phone alerts", icon: Bell, tone: "alerts" },
];

interface Props {
  section: AppSection;
  onSection: (section: AppSection) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenAppearance: () => void;
  paletteLabel: string;
  userName: string | null;
  authConfigured: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  /** True when this week's chase list has refreshed and has not been opened. */
  stormsNew?: boolean;
  children: ReactNode;
}

export default function AppShell({
  section,
  onSection,
  theme,
  onToggleTheme,
  onOpenAppearance,
  paletteLabel,
  userName,
  authConfigured,
  onSignIn,
  onSignOut,
  stormsNew = false,
  children,
}: Props) {
  return (
    <div className="flex h-[100dvh] overflow-hidden bg-app text-ink">
      <aside className="shell-rail hidden w-[248px] shrink-0 flex-col md:flex">
        <div className="px-3 pb-3 pt-4">
          <button type="button" className="brand-launcher press" aria-label="Swathline appearance" onClick={onOpenAppearance}>
            <LogoMark size={40} />
            <Wordmark />
          </button>
          <button type="button" className="appearance-open press" onClick={onOpenAppearance}>
            <Palette size={16} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold tracking-tight">Appearance</span>
              <span className="block text-[11px] text-muted">{paletteLabel}</span>
            </span>
          </button>
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
                data-tone={item.tone}
                className={`nav-item press ${on ? "nav-item-active" : ""}`}
              >
                <span className="nav-icon">
                  <Icon size={18} strokeWidth={2.1} />
                  {item.id === "storms" && stormsNew ? <span className="chase-dot" data-chase-new /> : null}
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
          className="tab-bar grid grid-cols-6 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden"
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
                data-tone={item.tone}
                className="tab-item"
              >
                <span className="tab-icon">
                  <Icon size={18} strokeWidth={on ? 2.35 : 1.85} />
                  {item.id === "storms" && stormsNew ? <span className="chase-dot" data-chase-new /> : null}
                </span>
                {item.label}
                {item.id === "storms" && stormsNew ? <span className="sr-only">New chase list</span> : null}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
