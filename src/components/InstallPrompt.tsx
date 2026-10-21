"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EllipsisVertical, Share } from "lucide-react";
import { INSTALL_DISMISS_KEY, shouldOfferInstall } from "@/lib/pwa-policy";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt({ hidden = false }: { hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const force = params.get("install") === "1";
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(INSTALL_DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setOpen(shouldOfferInstall({ dismissed, standalone, force }));

    function onPrompt(event: Event) {
      if (!shouldOfferInstall({ dismissed, standalone, force })) return;
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    } catch {
      /* Private mode can block storage. Closing still hides it for this visit. */
    }
    setOpen(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "accepted") dismiss();
  }

  if (!open || hidden) return null;

  return (
    <aside className="install-offer" data-install-prompt role="dialog" aria-labelledby="install-title">
      <div className="install-offer-body">
        <img className="install-app-icon" src="/icons/icon-192.png" alt="" width={72} height={72} />
        <h2 id="install-title">Add Swathline to your home screen</h2>
        {installEvent ? (
          <p>Install it and hail alerts open from the icon.</p>
        ) : (
          <>
            <p>Hail alerts on an iPhone start after you open Swathline from its icon.</p>
            <h3>iPhone, in Safari</h3>
            <ol className="install-steps">
              <Step n={1}>
                Tap the <Glyph><Share /></Glyph> Share button at the bottom of Safari.
              </Step>
              <Step n={2}>Tap Add to Home Screen.</Step>
              <Step n={3}>Tap Add, then open the Swathline icon.</Step>
            </ol>
            <h3>Android, in Chrome</h3>
            <ol className="install-steps">
              <Step n={1}>
                Tap the menu <Glyph><EllipsisVertical /></Glyph> in Chrome.
              </Step>
              <Step n={2}>Tap Install app, or Add to Home screen.</Step>
              <Step n={3}>Tap Install, then open the Swathline icon.</Step>
            </ol>
          </>
        )}
      </div>
      <div className="install-offer-actions">
        {installEvent ? (
          <button type="button" className="btn btn-primary press install-go" onClick={() => void install()}>
            Install Swathline
          </button>
        ) : (
          <button type="button" className="btn btn-primary press install-go" onClick={dismiss}>
            Got it
          </button>
        )}
        <button type="button" className="btn btn-secondary press" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li>
      <span className="install-num" aria-hidden>
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return <span className="install-glyph">{children}</span>;
}
