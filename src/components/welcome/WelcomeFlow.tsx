"use client";

import { useState } from "react";
import { WELCOME_SCREENS } from "@/lib/plain";

interface Props {
  onDone: () => void;
}

export default function WelcomeFlow({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const screen = WELCOME_SCREENS[step] ?? WELCOME_SCREENS[0];
  const last = step >= WELCOME_SCREENS.length - 1;
  return (
    <div className="welcome" data-welcome data-welcome-step={step + 1} role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-card">
        <button type="button" className="welcome-skip" onClick={onDone}>
          Skip
        </button>
        <WelcomeArt id={screen.id} />
        <h1 id="welcome-title">{screen.title}</h1>
        <p className="welcome-copy">{screen.body}</p>
        <div className="welcome-dots" aria-hidden="true">
          {WELCOME_SCREENS.map((item, index) => (
            <span key={item.id} data-on={index === step ? "true" : "false"} />
          ))}
        </div>
        {last ? (
          <button type="button" className="btn btn-primary welcome-next" data-welcome-done onClick={onDone}>
            Let's go
          </button>
        ) : (
          <button type="button" className="btn btn-primary welcome-next" data-welcome-next onClick={() => setStep((value) => value + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}

function WelcomeArt({ id }: { id: string }) {
  if (id === "money") {
    return (
      <svg className="welcome-art" viewBox="0 0 280 160" role="img" aria-label="Three ranked stops">
        <rect x="36" y="28" width="208" height="36" rx="12" className="welcome-card-shape" />
        <rect x="48" y="76" width="184" height="32" rx="12" className="welcome-card-shape" />
        <rect x="60" y="118" width="160" height="28" rx="12" className="welcome-card-shape" />
        <circle cx="58" cy="46" r="10" className="welcome-accent" />
        <circle cx="70" cy="92" r="8" className="welcome-swath" />
        <circle cx="82" cy="132" r="7" className="welcome-mark" />
      </svg>
    );
  }
  if (id === "work") {
    return (
      <svg className="welcome-art" viewBox="0 0 280 160" role="img" aria-label="A stop to work">
        <path d="M40 120 C80 40 200 40 240 120" className="welcome-path" />
        <circle cx="140" cy="78" r="22" className="welcome-accent" />
        <path d="M140 58 v28 M128 78 h24" className="welcome-pin" />
      </svg>
    );
  }
  return (
    <svg className="welcome-art" viewBox="0 0 280 160" role="img" aria-label="A map with a hail path">
      <rect x="24" y="18" width="232" height="124" rx="18" className="welcome-map" />
      <path d="M40 110 C90 40 170 130 244 48" className="welcome-path" />
      <circle cx="78" cy="86" r="7" className="welcome-swath" />
      <circle cx="150" cy="70" r="9" className="welcome-accent" />
      <circle cx="210" cy="58" r="6" className="welcome-mark" />
    </svg>
  );
}
