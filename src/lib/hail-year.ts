export type HailYearIntent = { kind: "browse" } | { kind: "year"; year: number };

const BROWSE = ["hail by year", "hail by years", "hail year", "hail years", "yearly hail", "by year"];

/** Map-search phrases that should open hail-by-year instead of geocoding. */
export function hailYearIntent(query: string, now = new Date()): HailYearIntent | null {
  const text = query.trim().replace(/\s+/g, " ").toLowerCase();
  if (!text) return null;
  if (BROWSE.some((phrase) => phrase === text || (text.length >= 3 && phrase.startsWith(text)))) {
    return { kind: "browse" };
  }
  const match = /^(?:hail(?:\s+in)?\s+)?(\d{4})$/i.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const max = now.getUTCFullYear();
  if (year < 1950 || year > max) return null;
  return { kind: "year", year };
}

/** Newest year first, back to the start of the storm archive. */
export function hailYearChoices(now = new Date()): number[] {
  const years: number[] = [];
  for (let year = now.getUTCFullYear(); year >= 1950; year -= 1) years.push(year);
  return years;
}

/** Inclusive calendar year, clamped so the end is not in the future. */
export function hailYearSpan(year: number, now = new Date()): { start: string; end: string } | null {
  const max = now.getUTCFullYear();
  if (!Number.isInteger(year) || year < 1950 || year > max) return null;
  const today = now.toISOString().slice(0, 10);
  const start = `${year}-01-01`;
  const end = `${year}-12-31` > today ? today : `${year}-12-31`;
  if (start > end) return null;
  return { start, end };
}
