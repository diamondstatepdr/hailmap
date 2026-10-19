"use client";

import { useEffect, useMemo, useState } from "react";
import { CALENDAR_MONTHS, CALENDAR_WEEKDAYS, HAIL_CALENDAR_BANDS, hailCalendarBand, monthCells } from "@/lib/hail-calendar";
import { formatDay } from "@/lib/history-range";

export interface CalendarMark {
  date: string;
  /** Largest hail that day, in inches. Null when the day was hit by wind or a tornado and no hail was reported. */
  inches: number | null;
}

interface Props {
  year: number;
  month: number;
  selected: string | null;
  marks: CalendarMark[];
  min?: string;
  max?: string;
  loading?: boolean;
  caption: string;
  onViewChange: (year: number, month: number) => void;
  onSelect: (date: string) => void;
}

export default function HailCalendar({ year, month, selected, marks, min = "1950-01-01", max, loading, caption, onViewChange, onSelect }: Props) {
  const [jumpOpen, setJumpOpen] = useState(false);
  const today = max ?? new Date().toISOString().slice(0, 10);
  useEffect(() => {
    if (!jumpOpen) return;
    const node = document.getElementById(`cal-year-${year}`);
    const parent = node?.parentElement;
    if (!node || !parent) return;
    parent.scrollLeft = node.offsetLeft - parent.clientWidth / 2 + node.clientWidth / 2;
  }, [jumpOpen, year]);
  const byDate = useMemo(() => new Map(marks.map((mark) => [mark.date, mark])), [marks]);
  const cells = monthCells(year, month);
  const minYear = Number(min.slice(0, 4));
  const maxYear = Number(today.slice(0, 4));
  const years = useMemo(() => {
    const list: number[] = [];
    for (let value = maxYear; value >= minYear; value -= 1) list.push(value);
    return list;
  }, [maxYear, minYear]);

  function shiftMonth(delta: number) {
    const cursor = new Date(Date.UTC(year, month - 1 + delta, 1));
    const nextYear = cursor.getUTCFullYear();
    const nextMonth = cursor.getUTCMonth() + 1;
    const stamp = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
    if (stamp < min.slice(0, 7) + "-01") return;
    if (`${nextYear}-${String(nextMonth).padStart(2, "0")}` > today.slice(0, 7)) return;
    onViewChange(nextYear, nextMonth);
  }

  function shiftYear(delta: number) {
    const nextYear = Math.min(maxYear, Math.max(minYear, year + delta));
    let nextMonth = month;
    if (nextYear === maxYear && nextMonth > Number(today.slice(5, 7))) nextMonth = Number(today.slice(5, 7));
    onViewChange(nextYear, nextMonth);
  }

  const title = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center">
          <button type="button" className="cal-nav" aria-label="Previous year" onClick={() => shiftYear(-1)} disabled={year <= minYear}>
            «
          </button>
          <button type="button" className="cal-nav" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            ‹
          </button>
        </div>
        <button type="button" className="min-w-0 flex-1 truncate px-1 text-sm font-semibold" aria-expanded={jumpOpen} onClick={() => setJumpOpen((open) => !open)}>
          {title}
        </button>
        <div className="flex items-center">
          <button type="button" className="cal-nav" aria-label="Next month" onClick={() => shiftMonth(1)} disabled={`${year}-${String(month).padStart(2, "0")}` >= today.slice(0, 7)}>
            ›
          </button>
          <button type="button" className="cal-nav" aria-label="Next year" onClick={() => shiftYear(1)} disabled={year >= maxYear}>
            »
          </button>
        </div>
      </div>
      {jumpOpen ? (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1 overflow-x-auto pb-1" role="listbox" aria-label="Year">
            {years.map((value) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={value === year}
                id={`cal-year-${value}`}
                className={`press shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${value === year ? "chip-on" : "chip"}`}
                onClick={() => shiftYear(value - year)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1" role="listbox" aria-label="Month">
            {CALENDAR_MONTHS.map((label, index) => {
              const value = index + 1;
              const stamp = `${year}-${String(value).padStart(2, "0")}`;
              const disabled = stamp < min.slice(0, 7) || stamp > today.slice(0, 7);
              return (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  aria-selected={value === month}
                  className={`press rounded-xl px-2 py-2 text-xs font-semibold disabled:opacity-30 ${value === month ? "chip-on" : "chip"}`}
                  onClick={() => {
                    onViewChange(year, value);
                    setJumpOpen(false);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted" aria-hidden>
        {CALENDAR_WEEKDAYS.map((day) => (
          <div key={day} className="py-1">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5" role="grid" aria-label={title}>
        {cells.map((date, index) => {
          if (!date) return <div key={`blank-${index}`} />;
          const mark = byDate.get(date);
          const band = mark?.inches != null ? hailCalendarBand(mark.inches) : null;
          const disabled = date < min || date > today;
          const selectedDay = date === selected;
          const label = mark?.inches != null ? `${formatDay(date)}, ${mark.inches.toFixed(2)} inch hail` : mark ? `${formatDay(date)}, wind or tornado` : formatDay(date);
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              disabled={disabled}
              aria-pressed={selectedDay}
              aria-label={label}
              onClick={() => onSelect(date)}
              data-hail={band?.id ?? (mark ? "hit" : undefined)}
              className={`press relative flex h-11 flex-col items-center justify-start rounded-xl pt-1 text-xs font-semibold disabled:opacity-30 ${selectedDay ? "bg-accent text-[var(--accent-ink)]" : band ? "bg-[var(--panel-2)]" : "hover:bg-[var(--panel-2)]"}`}
            >
              <span className="leading-none">{Number(date.slice(8, 10))}</span>
              {band ? (
                <span
                  className="mt-1 rounded-full"
                  style={{ width: band.px, height: band.px, background: selectedDay ? "var(--accent-ink)" : band.color }}
                />
              ) : mark ? (
                <span className="mt-1.5 h-2 w-2 rounded-full border-2 border-current" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-muted">
        {HAIL_CALENDAR_BANDS.filter((band) => band.id !== "under-1").map((band) => (
          <span key={band.id} className="inline-flex items-center gap-1">
            <span className="rounded-full" style={{ width: band.px, height: band.px, background: band.color }} />
            {band.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: HAIL_CALENDAR_BANDS[0].color }} />
          Under 1"
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">
        {loading ? "Loading hail days…" : caption}
      </p>
    </div>
  );
}
