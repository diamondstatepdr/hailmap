export interface HailYear {
  year: number;
  maxIn: number | null;
  days: number;
}

export interface HailYearInput {
  date: string;
  spotterMaxIn: number | null;
  meshMaxIn: number | null;
}

/** One row per calendar year in the span, newest first. Size is the larger of spotter and radar hail. */
export function yearlyHail(events: HailYearInput[], start: string, end: string): HailYear[] {
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) return [];
  const rows = new Map<number, HailYear>();
  for (let year = endYear; year >= startYear; year -= 1) {
    rows.set(year, { year, maxIn: null, days: 0 });
  }
  for (const event of events) {
    const year = Number(event.date.slice(0, 4));
    const row = rows.get(year);
    if (!row) continue;
    const inches = Math.max(event.spotterMaxIn ?? 0, event.meshMaxIn ?? 0);
    if (inches <= 0) continue;
    row.days += 1;
    row.maxIn = row.maxIn == null ? inches : Math.max(row.maxIn, inches);
  }
  return [...rows.values()];
}

/** Short ranges show quiet years. A long archive shows only the years that had hail. */
export function timelineRows(years: HailYear[]): HailYear[] {
  if (years.length <= 12) return years;
  return years.filter((year) => year.maxIn != null);
}
