"use client";

import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import { formatReplayClockParts, hailReportTicks } from "@/lib/replay-time";

interface ReportMark {
  occurredAt: string;
  hazard?: string;
}

interface Props {
  label: string;
  at: string | null;
  timeZone: string;
  frames: string[];
  reports: ReportMark[];
  playing: boolean;
  speed: 1 | 2 | 4;
  step: 15 | 60;
  index: number;
  count: number;
  loading: boolean;
  loadingLabel: string | null;
  note: string | null;
  onTogglePlay: () => void;
  onStep: (direction: -1 | 1) => void;
  onScrub: (index: number) => void;
  onSpeed: (speed: 1 | 2 | 4) => void;
  onStepSize: (step: 15 | 60) => void;
  onClose: () => void;
}

export default function StormReplayBar(props: Props) {
  const parts = props.at ? formatReplayClockParts(props.at, props.timeZone) : null;
  const timeLabel = parts ? `${parts.time} ${parts.period} ${parts.zone}`.replace(/\s+/g, " ").trim() : "Loading storm";
  const max = Math.max(0, props.count - 1);
  const ticks = hailReportTicks(props.frames, props.reports);
  const ready = props.count > 0 && parts;
  const progress = max > 0 ? Math.min(props.index, max) / max : 0;

  return (
    <div className="replay-bar pointer-events-auto glass absolute inset-x-2 bottom-2 z-30 sm:inset-x-3" data-replay-bar role="region" aria-label="Storm replay">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" className="replay-step press" aria-label="Step back" onClick={() => props.onStep(-1)} disabled={!props.count}>
            <SkipBack size={16} />
          </button>
          <button type="button" className="replay-play press" aria-label={props.playing ? "Pause" : "Play"} onClick={props.onTogglePlay} disabled={!props.count}>
            {props.playing ? <Pause size={18} /> : <Play size={18} className="translate-x-px" />}
          </button>
          <button type="button" className="replay-step press" aria-label="Step forward" onClick={() => props.onStep(1)} disabled={!props.count}>
            <SkipForward size={16} />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{props.label}</p>
          <p className="mt-1 flex items-baseline gap-1.5 whitespace-nowrap" data-replay-time={timeLabel}>
            <span className="replay-clock">{parts?.time ?? "–:–"}</span>
            {parts ? <span className="ml-2 text-[13px] font-semibold tracking-tight text-muted">{parts.period} {parts.zone}</span> : null}
          </p>
        </div>
        <button type="button" className="replay-step press" aria-label="Close replay" onClick={props.onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="replay-scrub">
        {ready ? (
          <>
            <div className="replay-ticks" aria-hidden>
              {ticks.map((percent) => (
                <span key={percent} className="replay-tick" style={{ left: `calc(${percent / 100} * (100% - 16px) + 8px)` }} />
              ))}
            </div>
            <input
              type="range"
              className="replay-range"
              min={0}
              max={max}
              step={1}
              value={Math.min(props.index, max)}
              aria-label="Replay time"
              aria-valuetext={timeLabel}
              style={{ ["--replay-progress" as string]: `calc(${progress} * (100% - 16px) + 8px)` }}
              onChange={(event) => props.onScrub(Number(event.target.value))}
            />
          </>
        ) : (
          <div className="replay-loading" role="progressbar" aria-label={props.loadingLabel ?? "Loading storm"} />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Replay step">
          <StepChip on={props.step === 15} label="15 min" onClick={() => props.onStepSize(15)} />
          <StepChip on={props.step === 60} label="1 hour" onClick={() => props.onStepSize(60)} />
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {props.loading && props.loadingLabel ? <span className="replay-status truncate">{props.loadingLabel}</span> : null}
          <div className="flex gap-1" role="group" aria-label="Replay speed">
            {([1, 2, 4] as const).map((value) => (
              <StepChip key={value} on={props.speed === value} label={`${value}x`} onClick={() => props.onSpeed(value)} />
            ))}
          </div>
        </div>
      </div>
      {props.note ? <p className="mt-1.5 text-xs leading-snug text-muted">{props.note}</p> : null}
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
