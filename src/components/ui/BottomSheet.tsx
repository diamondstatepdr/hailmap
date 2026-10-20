"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { resolveSheetGesture } from "@/lib/sheet-gesture";

interface Props {
  /** Accessible name for the dialog. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** CSS max-height while expanded. */
  expandedMax?: string;
  /** Visible height, in pixels, while collapsed. */
  peekHeight?: number;
  className?: string;
}

type Mode = "expanded" | "collapsed" | "dragging" | "dismissing";

const DISMISS_MS = 280;

/**
 * Glassy bottom sheet. The header drag handle collapses, expands, or dismisses.
 * Sheet content scrolls on its own and does not move the sheet.
 */
export default function BottomSheet({
  label,
  onClose,
  children,
  expandedMax = "min(78dvh, 42rem)",
  peekHeight = 132,
  className,
}: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const timerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  onCloseRef.current = onClose;
  const [mode, setMode] = useState<Mode>("expanded");
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    origin: number;
    from: "expanded" | "collapsed";
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const transform = `translateY(${Math.max(0, dragY)}px)`;

  function sheetHeight(): number {
    return sheetRef.current?.getBoundingClientRect().height ?? 0;
  }

  function collapsedOffset(): number {
    return Math.max(0, sheetHeight() - peekHeight);
  }

  function settle(next: "expanded" | "collapsed" | "dismissed", height: number) {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    const target =
      next === "dismissed" ? Math.max(height, peekHeight) : next === "collapsed" ? Math.max(0, height - peekHeight) : 0;
    // Turn the transition back on while the sheet is still under the finger,
    // then move it to the snap point on the next frame so the slide is visible.
    setMode(next === "dismissed" ? "dismissing" : next);
    frameRef.current = window.requestAnimationFrame(() => {
      setDragY(target);
      if (next === "dismissed") {
        timerRef.current = window.setTimeout(() => onCloseRef.current(), DISMISS_MS);
      }
    });
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || mode === "dismissing") return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, label")) return;
    const from: "expanded" | "collapsed" = mode === "collapsed" ? "collapsed" : "expanded";
    const origin = from === "collapsed" ? collapsedOffset() : 0;
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      origin,
      from,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragY(origin);
    setMode("dragging");
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dt = event.timeStamp - current.lastT;
    if (dt > 0) current.velocity = (event.clientY - current.lastY) / dt;
    current.lastY = event.clientY;
    current.lastT = event.timeStamp;
    const height = sheetHeight();
    const next = current.origin + (event.clientY - current.startY);
    setDragY(Math.min(Math.max(0, next), Math.max(height, 0)));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    const height = sheetHeight();
    const deltaY = event.clientY - current.startY;
    const decision = resolveSheetGesture({
      from: current.from,
      deltaY,
      velocityY: current.velocity,
      collapsible: height > peekHeight + 48,
    });
    settle(decision, height);
  }

  return (
    <section
      ref={sheetRef}
      className={`bottom-sheet sheet${className ? ` ${className}` : ""}`}
      role="dialog"
      aria-label={label}
      data-bottom-sheet
      data-sheet-state={mode}
      data-dragging={mode === "dragging" ? "true" : "false"}
      style={{
        ["--sheet-max" as string]: expandedMax,
        ["--sheet-peek" as string]: `${peekHeight}px`,
        transform,
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        className="sheet-grab"
        data-sheet-grab
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="sheet-handle" />
        <button type="button" className="sheet-close press" aria-label="Close" onClick={() => onClose()}>
          <X size={18} strokeWidth={2.4} />
        </button>
      </div>
      <div className="sheet-body" data-sheet-scroll={mode === "expanded" ? "true" : "false"}>
        {children}
      </div>
    </section>
  );
}
