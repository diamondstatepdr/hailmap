"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CanvassRepCount, CanvassStatus, CanvassStop } from "@/lib/canvass";

interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function useCanvass(enabled: boolean, bounds: Bounds | null) {
  const [stops, setStops] = useState<CanvassStop[]>([]);
  const [counts, setCounts] = useState<CanvassRepCount[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useMemo(() => {
    if (!bounds) return "";
    return [bounds.west, bounds.south, bounds.east, bounds.north].map((value) => value.toFixed(2)).join(",");
  }, [bounds]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStops([]);
      setCounts([]);
      return;
    }
    const params = new URLSearchParams();
    if (box) {
      const [west, south, east, north] = box.split(",");
      params.set("west", west);
      params.set("south", south);
      params.set("east", east);
      params.set("north", north);
    }
    const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    try {
      const [listResponse, statsResponse] = await Promise.all([
        fetch(`/api/canvass?${params}`),
        fetch(`/api/canvass/stats?day=${day}&tz=${encodeURIComponent(zone)}`),
      ]);
      if (listResponse.status === 401) {
        setStops([]);
        setCounts([]);
        return;
      }
      if (listResponse.ok) {
        const payload = (await listResponse.json()) as { stops?: CanvassStop[] };
        setStops(payload.stops ?? []);
      }
      if (statsResponse.ok) {
        const payload = (await statsResponse.json()) as { counts?: CanvassRepCount[] };
        setCounts(payload.counts ?? []);
      }
    } catch {
      // Polling can fail on a tunnel. The next pass retries.
    }
  }, [box, enabled]);

  useEffect(() => {
    void refresh();
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refresh();
    }, 8000);
    return () => window.clearInterval(id);
  }, [enabled, refresh]);

  async function save(input: { address: string; lat: number; lon: number; status: CanvassStatus; note: string; hailIn: number | null }) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/canvass", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as { stop?: CanvassStop; error?: string };
      if (!response.ok || !payload.stop) {
        setError(payload.error ?? "Could not save that house.");
        return;
      }
      setStops((current) => [payload.stop as CanvassStop, ...current.filter((stop) => stop.id !== payload.stop?.id)]);
      await refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return { stops, counts, saving, error, save };
}
