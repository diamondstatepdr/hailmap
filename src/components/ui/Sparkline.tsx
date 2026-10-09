interface Props {
  times: string[];
  hours: number;
  caption?: string;
  endAt?: string;
}

export default function Sparkline({ times, hours, caption = "Reports across this window", endAt }: Props) {
  const span = Math.max(hours, 0.75) * 3_600_000;
  const bins = hours <= 1 ? 8 : hours <= 6 ? 10 : hours <= 24 ? 12 : 14;
  const counts = Array.from({ length: bins }, () => 0);
  const parsedEnd = endAt ? Date.parse(endAt) : Number.NaN;
  const now = Number.isFinite(parsedEnd) ? parsedEnd : Date.now();
  for (const iso of times) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    const age = now - t;
    if (age < 0 || age > span) continue;
    const index = Math.min(bins - 1, Math.max(0, Math.floor(((span - age) / span) * bins)));
    counts[index] += 1;
  }
  const peak = Math.max(...counts);
  if (peak <= 0) return null;

  const width = 160;
  const height = 42;
  const step = width / (bins - 1);
  const points = counts.map((count, index) => {
    const x = index * step;
    const y = height - 6 - (count / peak) * (height - 12);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <figure>
      <figcaption className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        <span>Timeline</span>
        <span className="font-medium normal-case tracking-normal">{caption}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-11 w-full" role="img" aria-label={caption}>
        <path className="spark-fill" d={area} />
        <path className="spark-line" d={line} />
      </svg>
      <div className="mt-0.5 flex justify-between text-[10px] text-muted">
        <span>Earlier</span>
        <span>Now</span>
      </div>
    </figure>
  );
}
