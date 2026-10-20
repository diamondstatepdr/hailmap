"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import HailCalendar, { type CalendarMark } from "@/components/HailCalendar";
import { ADDRESS_SPANS, formatDay, type DateSpan } from "@/lib/history-range";
import type { DamageScore } from "@/lib/probability";
import ScoreRing from "@/components/ui/ScoreRing";

export interface AddressEventView {
  date: string;
  label: string;
  spotterMaxIn: number | null;
  hailCount: number;
  windMaxMph: number | null;
  windCount: number;
  tornado: string | null;
  tornadoCount: number;
  meshMaxIn: number | null;
  meshStatus: "ok" | "empty" | "pending" | "outside-archive" | "error" | "no-hail";
  warnings: Array<{ id: string; event: string }>;
  lossCandidate: boolean;
}

export interface AddressHistoryView {
  lat: number;
  lon: number;
  radiusKm: number;
  start: string;
  end: string;
  pendingDays: number;
  events: AddressEventView[];
  maxHailIn: number | null;
  selectedDate: string | null;
  score: DamageScore;
  warningNote: string | null;
}

interface Props {
  label: string;
  history: AddressHistoryView;
  spanId: string;
  loading?: boolean;
  onSpan: (id: string) => void;
  onSelectDate: (date: string) => void;
  onReplay?: (date: string) => void;
  onSave?: () => void;
  onReport?: () => void;
  onAlert?: () => void;
  onClose?: () => void;
  /** Drop the floating card chrome when a bottom sheet already provides it. */
  bare?: boolean;
}

export default function AddressHistoryCard({ label, history, spanId, loading, onSpan, onSelectDate, onReplay, onSave, onReport, onAlert, onClose, bare }: Props) {
  const score = history.score;
  const opened = useMemo(() => {
    let best = history.selectedDate ?? history.events[0]?.date ?? history.end;
    let size = -1;
    for (const event of history.events) {
      const inches = Math.max(event.spotterMaxIn ?? 0, event.meshMaxIn ?? 0);
      if (inches > size) {
        size = inches;
        best = event.date;
      }
    }
    return best;
  }, [history.events, history.selectedDate, history.end]);
  const [year, setYear] = useState(() => Number(opened.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(opened.slice(5, 7)));
  const placed = useRef(false);
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    const date = !placed.current ? opened : history.selectedDate && history.selectedDate !== lastSelected.current ? history.selectedDate : null;
    lastSelected.current = history.selectedDate;
    if (!placed.current) placed.current = true;
    if (!date) return;
    setYear(Number(date.slice(0, 4)));
    setMonth(Number(date.slice(5, 7)));
  }, [opened, history.selectedDate]);
  const marks = useMemo<CalendarMark[]>(() => {
    return history.events.flatMap((event): CalendarMark[] => {
      const inches = Math.max(event.spotterMaxIn ?? 0, event.meshMaxIn ?? 0);
      if (inches > 0) return [{ date: event.date, inches }];
      if (event.windCount || event.tornadoCount || event.windMaxMph != null || event.tornado) return [{ date: event.date, inches: null }];
      return [];
    });
  }, [history.events]);
  return (
    <article className={bare ? "px-4 pb-4" : "float-card p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Address history</p>
          <h2 className="mt-1 text-lg font-semibold leading-tight tracking-tight">{label}</h2>
          <p className="mt-1 text-xs text-muted">
            {formatDay(history.start)} – {formatDay(history.end)} · {history.radiusKm} km
            {history.pendingDays ? ` · loading ${history.pendingDays} recent days` : ""}
          </p>
          <p className="mt-1 text-sm font-semibold">
            Max hail in this range · {history.maxHailIn != null ? `${history.maxHailIn.toFixed(2)} in` : "None"}
          </p>
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} className="btn btn-secondary press px-3 py-1.5 text-xs">
            Close
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex gap-1.5 overflow-x-auto" role="group" aria-label="Address history span">
        {ADDRESS_SPANS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={spanId === item.id}
            onClick={() => onSpan(item.id)}
            className={`press shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${spanId === item.id ? "chip-on" : "chip"}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <h3 className="mt-4 text-sm font-semibold">Calendar</h3>
      <div className="mt-2 rounded-2xl border border-line bg-[var(--panel-2)] p-2">
        <HailCalendar
          year={year}
          month={month}
          selected={history.selectedDate}
          marks={marks}
          min={history.start}
          max={history.end}
          loading={loading && !history.events.length}
          caption="Dots are hail at this address, sized by the largest stone. A ring is wind or a tornado with no hail report. Tap a day to score that storm and load it on the map."
          onViewChange={(nextYear, nextMonth) => {
            setYear(nextYear);
            setMonth(nextMonth);
          }}
          onSelect={onSelectDate}
        />
      </div>
      <div className="mt-4 flex items-center gap-4">
        <ScoreRing score={score.score} level={score.level} />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            Damage score{history.selectedDate ? ` · ${formatDay(history.selectedDate)}` : ""}
          </p>
          <p className="mt-0.5 text-xl font-semibold tracking-tight">{score.level}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted">{score.summary}</p>
        </div>
      </div>
      <h3 className="mt-4 text-sm font-semibold">Timeline</h3>
      {loading && !history.events.length ? <p className="mt-2 text-sm text-muted">Checking hail, wind, tornado, radar, and warnings…</p> : null}
      {history.events.length ? (
        <ol className="mt-2 max-h-52 space-y-1.5 overflow-auto">
          {history.events.map((event) => (
            <li key={event.date} className="flex items-stretch gap-1.5">
              <button
                type="button"
                onClick={() => onSelectDate(event.date)}
                className={`press min-w-0 flex-1 rounded-xl px-3 py-2 text-left ${event.date === history.selectedDate ? "bg-accent/10 ring-1 ring-accent" : ""}`}
                style={{ background: event.date === history.selectedDate ? undefined : "var(--panel-2)" }}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {event.label}
                    {event.date === history.selectedDate ? <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-accent">Date of loss</span> : null}
                  </span>
                  <span className="text-sm font-semibold">{sizeLine(event.meshMaxIn, event.spotterMaxIn)}</span>
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Radar {inches(event.meshMaxIn, event.meshStatus)} · Spotter {inches(event.spotterMaxIn, event.hailCount ? "ok" : "empty")} · {event.hailCount} hail
                  {event.windMaxMph != null ? ` · ${event.windMaxMph} mph` : ""}
                  {event.tornado ? ` · ${event.tornado}` : ""}
                  {event.warnings.length ? ` · ${event.warnings.length} warning${event.warnings.length === 1 ? "" : "s"}` : ""}
                </span>
              </button>
              {onReplay ? (
                <button type="button" className="btn btn-primary press shrink-0 self-center px-2.5 py-2 text-xs" onClick={() => onReplay(event.date)}>
                  Replay
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted">No hail, wind, or tornado reports in this radius and span.</p>
      )}
      <h3 className="mt-4 text-sm font-semibold">Table</h3>
      <div className="mt-2 max-h-40 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1 pr-2 font-semibold">Date</th>
              <th className="py-1 pr-2 font-semibold">Radar</th>
              <th className="py-1 pr-2 font-semibold">Spotter</th>
              <th className="py-1 pr-2 font-semibold">Wind</th>
              <th className="py-1 font-semibold">Tornado</th>
            </tr>
          </thead>
          <tbody>
            {history.events.map((event) => (
              <tr key={`table-${event.date}`} className="border-b border-line">
                <td className="py-1.5 pr-2">
                  <button type="button" className="font-semibold text-accent" onClick={() => onSelectDate(event.date)}>
                    {event.label}
                  </button>
                </td>
                <td className="py-1.5 pr-2">{inches(event.meshMaxIn, event.meshStatus)}</td>
                <td className="py-1.5 pr-2">{event.spotterMaxIn != null ? `${event.spotterMaxIn.toFixed(2)} in` : "—"}</td>
                <td className="py-1.5 pr-2">{event.windMaxMph != null ? `${event.windMaxMph}` : "—"}</td>
                <td className="py-1.5">{event.tornado ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {history.warningNote ? <p className="mt-2 text-xs leading-relaxed text-muted">{history.warningNote}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {onAlert ? (
          <button type="button" onClick={onAlert} className="btn btn-primary press">
            <Bell size={16} />
            Alert me here
          </button>
        ) : null}
        {onSave ? (
          <button type="button" onClick={onSave} className="btn btn-secondary press">
            Save to watch list
          </button>
        ) : null}
        {onReport ? (
          <button type="button" onClick={onReport} className="btn btn-secondary press">
            Storm report
          </button>
        ) : null}
      </div>
    </article>
  );
}

function inches(value: number | null, status: string): string {
  if (status === "pending") return "…";
  if (status === "no-hail") return "No hail reports";
  if (status === "outside-archive") return "n/a";
  if (status === "error") return "—";
  if (value == null) return "—";
  return `${value.toFixed(2)} in`;
}

function sizeLine(mesh: number | null, spotter: number | null): string {
  const value = Math.max(mesh ?? 0, spotter ?? 0);
  return value > 0 ? `${value.toFixed(2)} in` : "—";
}

export type { DateSpan };
