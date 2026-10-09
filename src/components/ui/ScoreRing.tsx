"use client";

import { useEffect, useState } from "react";

const TONE: Record<string, string> = {
  Low: "var(--low)",
  Moderate: "var(--moderate)",
  High: "var(--high)",
  "Very High": "var(--severe)",
};

interface Props {
  score: number;
  level: string;
}

export default function ScoreRing({ score, level }: Props) {
  const radius = 34;
  const circ = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const target = circ * (1 - clamped / 100);
  const [offset, setOffset] = useState(circ);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOffset(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return (
    <div className="score-ring" aria-hidden>
      <svg viewBox="0 0 88 88">
        <circle className="score-track" cx="44" cy="44" r={radius} />
        <circle
          className="score-arc"
          cx="44"
          cy="44"
          r={radius}
          stroke={TONE[level] ?? TONE.Low}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="score-center">
        <div>
          <strong>{clamped}</strong>
          <span>/100</span>
        </div>
      </div>
    </div>
  );
}

export function levelTone(level: string): string {
  if (level === "Very High") return "#e11d48";
  if (level === "High") return "#ea580c";
  if (level === "Moderate") return "#d97706";
  return "#0f9f6e";
}
