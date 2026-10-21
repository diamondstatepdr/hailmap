import type { SourceSpan } from "@/lib/source-coverage";

export default function SourceYears({ spans }: { spans: SourceSpan[] }) {
  return (
    <section className="source-years" aria-label="What each source covers">
      <h3>What each source covers</h3>
      <ul>
        {spans.map((span) => (
          <li key={span.source}>
            <p>
              <strong>{span.source}.</strong> {span.years} {span.detail}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
