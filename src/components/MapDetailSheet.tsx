"use client";

import { useRef, type ReactNode, type TouchEvent } from "react";
import { X } from "lucide-react";

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom map card for a report, warning, or radar swath. */
export default function MapDetailSheet({ label, onClose, children }: Props) {
  const start = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.changedTouches[0];
    if (!touch) return;
    start.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent<HTMLElement>) {
    const origin = start.current;
    start.current = null;
    const touch = event.changedTouches[0];
    if (!origin || !touch) return;
    const dy = touch.clientY - origin.y;
    const dx = touch.clientX - origin.x;
    if (dy > 64 && dy > Math.abs(dx) * 1.4) onClose();
  }

  return (
    <article
      className="float-card map-detail p-4"
      role="dialog"
      aria-label={label}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="map-detail-grip md:hidden" aria-hidden />
      <button type="button" className="detail-close press" aria-label="Close" onClick={onClose}>
        <X size={18} strokeWidth={2.4} />
      </button>
      <div className="map-detail-body">{children}</div>
    </article>
  );
}
