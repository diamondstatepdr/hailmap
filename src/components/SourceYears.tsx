"use client";

import { useState } from "react";
import { sourceDetail, type SourceSpan } from "@/lib/source-coverage";

export default function SourceYears({
  spans,
  start,
  end,
}: {
  spans: SourceSpan[];
  start?: string;
  end?: string;
}) {
  const [open, setOpen] = useState(false);
  const detail =
    start && end
      ? sourceDetail({ start, end })
      : spans.map((span) => span.detail).filter(Boolean).join(" ");
  return (
    <section className="source-years" aria-label="What each source covers">
      <div className="source-years-head">
        <h3>What each source covers</h3>
        <button
          type="button"
          className="help-chip"
          aria-expanded={open}
          aria-label="Source details"
          onClick={() => setOpen((value) => !value)}
        >
          ?
        </button>
      </div>
      <ul>
        {spans.map((span) => (
          <li key={span.source}>
            {span.source}: {span.years}
          </li>
        ))}
      </ul>
      {open ? <p className="source-years-detail">{detail}</p> : null}
    </section>
  );
}
