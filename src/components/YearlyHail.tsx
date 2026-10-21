import { timelineRows, yearlyHail, type HailYearInput } from "@/lib/yearly-hail";

function inches(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}"`;
}

export default function YearlyHail({
  events,
  start,
  end,
  loading,
}: {
  events: HailYearInput[];
  start: string;
  end: string;
  loading?: boolean;
}) {
  const years = timelineRows(yearlyHail(events, start, end));
  const peak = Math.max(1, ...years.map((year) => year.maxIn ?? 0));
  const any = years.some((year) => year.maxIn != null);
  return (
    <section className="year-hail" aria-label="Hail by year">
      <h3>Hail by year</h3>
      {loading && !any ? <p>Checking this address…</p> : null}
      {!loading && !any ? <p>No hail in this range.</p> : null}
      {any ? (
        <ol>
          {years.map((year) => {
            const width = year.maxIn == null ? 0 : Math.max(8, Math.round((year.maxIn / peak) * 100));
            return (
              <li key={year.year}>
                <span className="year-hail-label">{year.year}</span>
                <span className="year-hail-track" aria-hidden>
                  {year.maxIn != null ? <span className="year-hail-bar" style={{ width: `${width}%` }} /> : null}
                </span>
                <span className="year-hail-size">{year.maxIn == null ? "None" : inches(year.maxIn)}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
