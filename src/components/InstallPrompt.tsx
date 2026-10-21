"use client";

import { useEffect, useState } from "react";
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
        <p className="install-kicker">Home screen</p>
        <h2 id="install-title">Add Swathline to your home screen</h2>
        <p>Hail alerts on an iPhone start after you open Swathline from its icon. Android can install it the same way.</p>
        <h3>iPhone, in Safari</h3>
        <ol>
          <li>Tap Share at the bottom of Safari.</li>
          <li>Tap Add to Home Screen.</li>
          <li>Tap Add, then open the Swathline icon.</li>
        </ol>
        <h3>Android, in Chrome</h3>
        <ol>
          <li>Tap the three dots in Chrome.</li>
          <li>Tap Install app, or Add to Home screen.</li>
          <li>Tap Install, then open the Swathline icon.</li>
        </ol>
      </div>
      <div className="install-offer-actions">
        {installEvent ? (
          <button type="button" className="btn btn-primary press" onClick={() => void install()}>
            Install
          </button>
        ) : null}
        <button type="button" className="btn btn-secondary press" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}
