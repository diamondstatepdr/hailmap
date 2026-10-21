"use client";

import { useState, type ReactNode } from "react";
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

const BANDS = [
  { color: "#16a34a", d: "M34 112 C78 74 112 122 156 96 C198 72 220 112 250 84 L250 126 C206 140 156 116 104 132 C58 144 38 124 34 128 Z" },
  { color: "#facc15", d: "M50 108 C86 80 114 116 158 94 C194 76 216 104 238 88 L234 118 C198 128 160 108 112 122 C74 132 54 116 50 118 Z" },
  { color: "#f97316", d: "M68 102 C96 84 120 110 160 94 C188 82 208 100 226 92 L222 110 C192 116 164 104 122 114 C92 122 74 110 68 112 Z" },
  { color: "#e11d48", d: "M86 98 C108 86 126 104 162 94 C184 86 200 98 214 94 L210 106 C188 110 168 102 132 108 C108 114 94 104 86 106 Z" },
  { color: "#d946ef", d: "M104 96 C120 90 132 100 164 94 C180 90 192 98 204 96 L202 104 C184 106 170 100 140 104 C122 108 110 100 104 102 Z" },
];

function WelcomeArt({ id }: { id: string }) {
  if (id === "money") {
    return (
      <MapScene id="money" label="A hail map with the best stops ranked">
        <SteppedBands />
        <Pin x={168} y={78} glow="money" />
        <g className="welcome-ranks">
          <Rank y={30} n="1" label="Best stop" wide />
          <Rank y={64} n="2" label="Next lot" />
          <Rank y={98} n="3" label="Neighborhood" short />
        </g>
      </MapScene>
    );
  }
  if (id === "work") {
    return (
      <MapScene id="work" label="A hail map with the stop to work">
        <SteppedBands />
        <path d="M48 118 C92 96 124 108 156 90 C188 72 206 84 228 70" className="welcome-route" />
        <Pin x={228} y={70} glow="work" />
        <g className="welcome-work-card">
          <rect x="36" y="28" width="118" height="40" rx="12" />
          <text x="50" y="46" className="welcome-rank-label">Work this stop</text>
          <text x="50" y="60" className="welcome-rank-sub">Search, then go</text>
        </g>
      </MapScene>
    );
  }
  return (
    <MapScene id="see" label="A map with a hail path and a pin">
      <SteppedBands />
      <Pin x={186} y={86} glow="see" />
    </MapScene>
  );
}

function MapScene({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <svg className="welcome-art" viewBox="0 0 280 156" role="img" aria-label={label}>
      <defs>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`${id}-wash`} cx="72%" cy="42%" r="58%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="8" y="6" width="264" height="144" rx="22" className="welcome-frame" />
      <rect x="18" y="16" width="244" height="124" rx="16" className="welcome-ground" />
      <rect x="18" y="16" width="244" height="124" rx="16" fill={`url(#${id}-wash)`} />
      <g className="welcome-grid" aria-hidden="true">
        <path d="M18 52 H262 M18 88 H262 M18 120 H262 M78 16 V140 M148 16 V140 M214 16 V140" />
      </g>
      {children}
    </svg>
  );
}

function SteppedBands() {
  return (
    <g className="welcome-bands">
      {BANDS.map((band) => (
        <path key={band.color} className="welcome-band" d={band.d} fill={band.color} />
      ))}
    </g>
  );
}

function Pin({ x, y, glow }: { x: number; y: number; glow: string }) {
  return (
    <g className="welcome-pin-mark" filter={`url(#${glow}-glow)`} transform={`translate(${x - 12} ${y - 30})`}>
      <path className="welcome-pin-shape" d="M12 0C5.4 0 0 5.2 0 11.6 0 20.4 12 32 12 32s12-11.6 12-20.4C24 5.2 18.6 0 12 0z" />
      <circle className="welcome-pin-core" cx="12" cy="12" r="4.2" />
    </g>
  );
}

function Rank({ y, n, label, wide, short }: { y: number; n: string; label: string; wide?: boolean; short?: boolean }) {
  const width = wide ? 128 : short ? 108 : 118;
  return (
    <g className="welcome-rank" transform={`translate(28 ${y})`}>
      <rect width={width} height="28" rx="10" />
      <circle className="welcome-rank-dot" cx="16" cy="14" r="8" />
      <text className="welcome-rank-num" x="16" y="18" textAnchor="middle">
        {n}
      </text>
      <text className="welcome-rank-label" x="30" y="18">
        {label}
      </text>
    </g>
  );
}
