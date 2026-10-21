"use client";

import { PATH_TIP, RADAR_TIP, SCORE_TIP } from "@/lib/plain";

const STEPS = [
  "Search an address, or just move the map.",
  "Use Hail · 7 days to look at today, this week, or one storm day.",
  "Open Chase list for the biggest storms this week.",
  "Open Money spots for the lots and neighborhoods under the hail.",
  "Tap a colored hail path to see how big the stones were.",
];

export default function HelpGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-guide" data-help role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div className="help-card">
        <h2 id="help-title">What do I do here?</h2>
        <ol className="help-steps">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <dl className="help-glossary">
          <div>
            <dt>Hail path</dt>
            <dd>{PATH_TIP}</dd>
          </div>
          <div>
            <dt>Radar and spotter</dt>
            <dd>{RADAR_TIP}</dd>
          </div>
          <div>
            <dt>Money Hole score</dt>
            <dd>{SCORE_TIP}</dd>
          </div>
        </dl>
        <button type="button" className="btn btn-primary help-close" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
