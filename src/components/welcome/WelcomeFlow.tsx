"use client";

import { useLayoutEffect, useRef } from "react";
import { LogoMark, Wordmark } from "@/components/brand/Logo";
import { INTRO } from "@/lib/plain";

interface Props {
  onDone: () => void;
}

const BANDS = [
  { color: "#16a34a", d: "M18 118 C62 78 108 124 160 92 C210 62 248 108 302 74 L302 128 C240 146 188 112 128 136 C72 154 36 132 18 136 Z" },
  { color: "#facc15", d: "M36 112 C74 82 112 118 164 92 C206 72 240 100 286 80 L282 118 C230 132 184 106 124 124 C80 138 50 122 36 124 Z" },
  { color: "#f97316", d: "M58 106 C90 84 122 112 168 92 C204 78 232 96 270 86 L266 110 C222 120 184 102 128 114 C96 124 72 112 58 114 Z" },
  { color: "#e11d48", d: "M84 100 C108 86 132 106 170 92 C198 82 220 94 252 90 L248 104 C214 110 186 100 140 108 C112 114 94 106 84 108 Z" },
  { color: "#d946ef", d: "M108 96 C126 88 142 100 172 92 C194 86 210 94 234 92 L232 102 C208 106 186 98 150 104 C128 108 116 100 108 102 Z" },
];

const SIZES = [
  { label: '<1"', color: "#16a34a" },
  { label: '1"', color: "#facc15" },
  { label: '1.5"', color: "#f97316" },
  { label: '2"', color: "#e11d48" },
  { label: '2.5"+', color: "#d946ef" },
];

const TOWN_DOTS = [
  { name: "Lubbock", x: 24, y: 38 },
  { name: "Amarillo", x: 140, y: 32 },
  { name: "Wichita", x: 228, y: 46 },
];

export default function WelcomeFlow({ onDone }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const upgrading = useRef(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || document.documentElement.dataset.intro === "skip" || dialog.matches(":modal")) return;
    upgrading.current = true;
    if (dialog.open) dialog.close();
    dialog.showModal();
    requestAnimationFrame(() => {
      upgrading.current = false;
    });
    dialog.querySelector<HTMLButtonElement>("[data-welcome-done]")?.focus();
  }, []);

  function closed() {
    // close() during the modal upgrade fires this, then showModal() opens it again.
    if (upgrading.current || dialogRef.current?.open) return;
    onDone();
  }

  function dismiss() {
    const dialog = dialogRef.current;
    if (dialog) dialog.close();
    else onDone();
  }

  function startTrial() {
    onDone();
    window.location.assign("/pricing");
  }

  return (
    <dialog
      ref={dialogRef}
      className="welcome"
      open
      data-welcome
      aria-labelledby="welcome-title"
      onClose={closed}
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      <div className="welcome-sheet">
        <button type="button" className="welcome-skip" onClick={dismiss}>
          Skip
        </button>
        <p className="welcome-brand">
          <LogoMark size={32} title="Swathline" />
          <Wordmark />
        </p>
        <p className="welcome-for">{INTRO.kicker}</p>
        <h1 id="welcome-title">{INTRO.title}</h1>
        <p className="welcome-copy">{INTRO.body}</p>
        <svg className="welcome-art" viewBox="0 0 320 168" role="img" aria-label="A hail swath across Amarillo, Lubbock, and Wichita">
          <rect x="0" y="0" width="320" height="168" rx="18" className="welcome-frame" />
          <rect x="8" y="8" width="304" height="152" rx="14" className="welcome-ground" />
          <g className="welcome-grid" aria-hidden="true">
            <path d="M8 46 H312 M8 84 H312 M8 122 H312 M72 8 V160 M148 8 V160 M228 8 V160" />
          </g>
          <g className="welcome-bands">
            {BANDS.map((band) => (
              <path key={band.color} className="welcome-band" d={band.d} fill={band.color} />
            ))}
          </g>
          {TOWN_DOTS.map((town) => (
            <g key={town.name} className="welcome-town" transform={`translate(${town.x} ${town.y})`}>
              <circle r="4.5" />
              <text x="8" y="4">
                {town.name}
              </text>
            </g>
          ))}
        </svg>
        <ul className="welcome-sizes" aria-label="Hail size">
          {SIZES.map((size) => (
            <li key={size.label}>
              <span style={{ background: size.color }} />
              {size.label}
            </li>
          ))}
        </ul>
        <ul className="welcome-tools">
          {INTRO.tools.map((tool) => (
            <li key={tool}>{tool}</li>
          ))}
        </ul>
        <p className="welcome-price">{INTRO.price}</p>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary welcome-go" data-welcome-done autoFocus onClick={dismiss}>
            {INTRO.map}
          </button>
          <button type="button" className="btn welcome-trial" onClick={startTrial}>
            {INTRO.trial}
          </button>
        </div>
      </div>
    </dialog>
  );
}
