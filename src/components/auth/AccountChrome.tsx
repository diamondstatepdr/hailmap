import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "@/components/brand/Logo";

export default function AccountChrome({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <main
      className={`mx-auto flex min-h-[100dvh] w-full flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1.5rem,env(safe-area-inset-top))] ${wide ? "max-w-5xl" : "max-w-lg sm:justify-center"} sm:py-10`}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <LogoMark size={40} title="Swathline" />
          <Wordmark subtitle={null} />
        </Link>
        <Link href="/" className="shrink-0 text-sm font-semibold text-accent">
          Map
        </Link>
      </div>
      <h1 className="sr-only">{title}</h1>
      {children}
    </main>
  );
}
