"use client";

import { useId, useState } from "react";

/** A small inline (?) that opens one sentence. Tap again to close. */
export default function Explain({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="explain">
      <button
        type="button"
        className="explain-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        (?)
      </button>
      {open ? (
        <span id={id} className="explain-pop" role="note">
          {children}
        </span>
      ) : null}
    </span>
  );
}
