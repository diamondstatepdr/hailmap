"use client";

import { useEffect, useState } from "react";
import { updatedAgoLabel } from "@/lib/list-freshness";

/** Small freshness line for the Money Hole list and the Chase List. */
export default function UpdatedLine({ at, now }: { at: string | null | undefined; now?: Date }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const label = updatedAgoLabel(at, now ?? new Date());
  void tick;
  if (!label) return null;
  return (
    <p className="mt-1 text-xs text-muted" data-updated>
      {label}
    </p>
  );
}
