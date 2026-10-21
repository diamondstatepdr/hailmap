export interface SourceSpan {
  source: string;
  years: string;
  detail: string;
}

/** Three plain lines for the address screen. The longer note is behind the question mark. */
export function sourceCoverage(_span: { start: string; end: string }): SourceSpan[] {
  return [
    {
      source: "Storm spotter reports",
      years: "since 1955",
      detail: "Hail and wind since 1955. Tornadoes since 1950.",
    },
    {
      source: "Radar hail maps",
      years: "since Aug 2019",
      detail: "Radar maps of hail size start in August 2019. Older years use spotter reports.",
    },
    {
      source: "Warnings",
      years: "since 1986",
      detail: "Warnings at an address start in 1986.",
    },
  ];
}

export function sourceDetail(span: { start: string; end: string }): string {
  const lines = sourceCoverage(span).map((item) => item.detail);
  return `${lines.join(" ")} This view runs from ${span.start} through ${span.end}.`;
}
