"use client";

import { Flag } from "lucide-react";

interface Props {
  unseen: boolean;
  expanded: boolean;
  onClick: () => void;
}

/** Map control that opens this week's chase list. */
export default function ChaseMapButton({ unseen, expanded, onClick }: Props) {
  return (
    <button
      type="button"
      className="chase-open press"
      data-tone="chase"
      data-chase-open
      aria-expanded={expanded}
      aria-haspopup="dialog"
      aria-label="Chase list"
      onClick={onClick}
    >
      <Flag size={16} aria-hidden />
      Chase
      {unseen ? <span className="chase-dot" data-chase-new /> : null}
      {unseen ? <span className="sr-only">New chase list</span> : null}
    </button>
  );
}
