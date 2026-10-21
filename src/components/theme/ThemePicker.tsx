"use client";

import { useEffect, useRef } from "react";
import { Check, Moon, SunMedium, X } from "lucide-react";
import { PALETTE_CHOICES, type PaletteId } from "@/lib/palette";

const PREVIEW: Record<PaletteId, { sky: string; road: string; glow: string; ink: string; dots: string[] }> = {
  a: {
    sky: "linear-gradient(160deg, #071433, #123a9a 58%, #0e7490)",
    road: "#1a6a86",
    glow: "#67e8f9",
    ink: "#f7fbff",
    dots: ["#1d4ed8", "#9d174d", "#0e7490"],
  },
  b: {
    sky: "linear-gradient(160deg, #1a0e08, #9a3412 58%, #c2410c)",
    road: "#8a4b16",
    glow: "#fbbf24",
    ink: "#fff8f1",
    dots: ["#c2410c", "#b45309", "#991b1b"],
  },
  c: {
    sky: "linear-gradient(160deg, #07161a, #0f766e 55%, #5b21b6)",
    road: "#1d6b66",
    glow: "#5eead4",
    ink: "#f4fffc",
    dots: ["#0f766e", "#6d28d9", "#0369a1"],
  },
};

interface Props {
  palette: PaletteId;
  scheme: "light" | "dark";
  onPalette: (id: PaletteId) => void;
  onScheme: (scheme: "light" | "dark") => void;
  onClose: () => void;
}

export default function ThemePicker({ palette, scheme, onPalette, onScheme, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="theme-picker-root">
      <button type="button" className="theme-picker-backdrop" aria-label="Close appearance" onClick={onClose} />
      <section
        className="theme-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-picker-title"
        data-theme-picker
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="theme-picker-head">
          <div>
            <p className="theme-picker-kicker">Swathline</p>
            <h2 id="theme-picker-title">Appearance</h2>
          </div>
          <button type="button" ref={closeRef} className="theme-picker-close press" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="theme-seg theme-picker-scheme" role="group" aria-label="Light or dark">
          <button type="button" aria-pressed={scheme === "light"} onClick={() => scheme !== "light" && onScheme("light")}>
            <SunMedium size={14} className="mx-auto mb-0.5" />
            Light
          </button>
          <button type="button" aria-pressed={scheme === "dark"} onClick={() => scheme !== "dark" && onScheme("dark")}>
            <Moon size={14} className="mx-auto mb-0.5" />
            Dark
          </button>
        </div>
        <div className="theme-swatches" role="radiogroup" aria-label="Color theme">
          {PALETTE_CHOICES.map((choice) => {
            const look = PREVIEW[choice.id];
            const selected = palette === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-palette-choice={choice.id}
                className="theme-swatch press"
                onClick={() => onPalette(choice.id)}
              >
                <span className="theme-swatch-sky" style={{ background: look.sky, color: look.ink }} aria-hidden="true">
                  <span className="theme-swatch-road" style={{ background: look.road, boxShadow: `0 0 10px ${look.glow}` }} />
                  <span className="theme-swatch-hail" />
                  <span className="theme-swatch-dots">
                    {look.dots.map((dot) => (
                      <span key={dot} style={{ background: dot }} />
                    ))}
                  </span>
                </span>
                <span className="theme-swatch-copy">
                  <span className="theme-swatch-name">
                    {choice.name}
                    {selected ? <Check size={16} aria-hidden /> : null}
                  </span>
                  <span className="theme-swatch-line">{choice.line}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
