"use client";

import { Gem, X } from "lucide-react";
import BottomSheet from "@/components/ui/BottomSheet";
import { ChaseModeToggle, ChaseRows } from "@/components/chase/ChaseList";
import type { ChasePayload, ChaseStop } from "@/lib/chase-week";
import type { HoneyMode } from "@/lib/honey";
import { formatDay } from "@/lib/history-range";

interface Props {
  mobile: boolean;
  mode: HoneyMode;
  payload: ChasePayload;
  preview: boolean;
  onMode: (mode: HoneyMode) => void;
  onClose: () => void;
  onSeeAll: () => void;
  onSelect: (stop: ChaseStop) => void;
}

export default function ChasePopup({ mobile, mode, payload, preview, onMode, onClose, onSeeAll, onSelect }: Props) {
  const body = (
    <div className="chase-body">
      <header className="chase-head sheet-band">
        <div className="min-w-0">
          <p className="honey-kicker">
            <Gem size={13} />
            Money Hole
          </p>
          <h2>This week&apos;s chase list</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Top hail areas from the last 7 days, ranked by Money Hole score. {formatDay(payload.windowStart)} – {formatDay(payload.windowEnd)}.
          </p>
        </div>
        {mobile ? null : (
          <button type="button" className="honey-close press" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        )}
      </header>
      <ChaseModeToggle mode={mode} onMode={onMode} />
      <ChaseRows mode={mode} payload={payload} preview={preview} onSelect={onSelect} />
      {preview ? (
        <button type="button" className="chase-see press" data-chase-see-all onClick={onSeeAll}>
          See all
        </button>
      ) : null}
    </div>
  );

  if (mobile) {
    return (
      <div className="sheet-dock chase-sheet-dock pointer-events-none absolute inset-x-0 bottom-0" data-chase-popup data-tone="chase">
        <BottomSheet label="This week's Money Holes" tone="chase" onClose={onClose} expandedMax="100%" peekHeight={148}>
          {body}
        </BottomSheet>
      </div>
    );
  }

  return (
    <div className="chase-pop-dock" data-chase-popup data-tone="chase">
      <section className="chase-pop glass" role="dialog" aria-label="This week's Money Holes" onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}>
        {body}
      </section>
    </div>
  );
}
