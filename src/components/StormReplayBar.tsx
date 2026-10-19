"use client";

import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { formatReplayClock } from "@/lib/replay-time";

interface Props {
  label: string;
  at: string | null;
  timeZone: string;
  playing: boolean;
  speed: 1 | 2 | 4;
  step: 15 | 60;
  index: number;
  count: number;
  loading: boolean;
  note: string | null;
  onTogglePlay: () => void;
  onStep: (direction: -1 | 1) => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: 1 | 2 | 4) => void;
  onStepSize: (step: 15 | 60) => void;
  onClose: () => void;
}

export default function StormReplayBar(props: Props) {
  const timeLabel = props.at ? formatReplayClock(props.at, props.timeZone) : "Loading storm…";
  const max = Math.max(0, props.count - 1);
  return (
    <div className="pointer-events-auto glass absolute inset-x-2 bottom-2 z-30 rounded-2xl px-2.5 py-2 sm:inset-x-3 sm:px-3" data-replay-bar role="region" aria-label="Storm replay">
      <div className="flex items-center gap-1.5">
        <button type="button" className="icon-btn press disabled:opacity-40" aria-label="Step back" onClick={() => props.onStep(-1)} disabled={!props.count}>
          <SkipBack size={16} />
        </button>
        <button type="button" className="icon-btn press disabled:opacity-40" aria-label={props.playing ? "Pause" : "Play"} onClick={props.onTogglePlay} disabled={!props.count}>
          {props.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="icon-btn press disabled:opacity-40" aria-label="Step forward" onClick={() => props.onStep(1)} disabled={!props.count}>
          <SkipForward size={16} />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="truncate text-[11px] font-semibold text-muted">{props.label}</p>
          <p className="truncate text-sm font-semibold tabular-nums" data-replay-time>
            {timeLabel}
          </p>
        </div>
        <button type="button" className="icon-btn press" aria-label="Close replay" onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>
      <input
        type="range"
        className="mt-1.5 w-full"
        min={0}
        max={max}
        step={1}
        value={Math.min(props.index, max)}
        aria-label="Replay time"
        aria-valuetext={timeLabel}
        disabled={!props.count}
        onChange={(event) => props.onScrub(Number(event.target.value))}
      />
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Replay step">
          <StepChip on={props.step === 15} label="15 min" onClick={() => props.onStepSize(15)} />
          <StepChip on={props.step === 60} label="1 hour" onClick={() => props.onStepSize(60)} />
        </div>
        <div className="flex gap-1" role="group" aria-label="Replay speed">
          {([1, 2, 4] as const).map((value) => (
            <StepChip key={value} on={props.speed === value} label={`${value}x`} onClick={() => props.onSpeed(value)} />
          ))}
        </div>
      </div>
      {props.note ? <p className="mt-1 text-[10px] leading-snug text-muted">{props.loading ? `Loading radar… ${props.note}` : props.note}</p> : null}
    </div>
  );
}

function StepChip({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`press rounded-full px-2.5 py-1 text-[11px] font-semibold ${on ? "chip-on" : "chip"}`}>
      {label}
    </button>
  );
}
