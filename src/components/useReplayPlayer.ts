"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { HailReport } from "@/lib/types";
import type { ReplayBounds } from "@/lib/replay-time";

export interface ReplayLaunch {
  date: string;
  bounds: ReplayBounds;
  label: string;
}

interface ReplayManifest {
  date: string;
  timeZone: string;
  start: string;
  end: string;
  frames: string[];
  reports: HailReport[];
  warnings: FeatureCollection;
  warningNote: string | null;
  radarNote: string;
  error?: string;
}

export interface ReplayRadar {
  at: string;
  status: "ok" | "empty" | "unavailable" | "error";
  note: string;
  collection: FeatureCollection;
  pulse: FeatureCollection;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function strideFor(step: 15 | 60): number {
  return step === 60 ? 4 : 1;
}

export function useReplayPlayer() {
  const [launch, setLaunch] = useState<ReplayLaunch | null>(null);
  const [manifest, setManifest] = useState<ReplayManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [step, setStep] = useState<15 | 60>(15);
  const [radarByTime, setRadarByTime] = useState<Record<string, ReplayRadar>>({});
  const [radarLoading, setRadarLoading] = useState(false);
  const token = useRef(0);

  function start(next: ReplayLaunch) {
    token.current += 1;
    setLaunch(next);
    setManifest(null);
    setManifestError(null);
    setIndex(0);
    setPlaying(false);
    setRadarByTime({});
    setRadarLoading(false);
  }

  function stop() {
    token.current += 1;
    setLaunch(null);
    setManifest(null);
    setPlaying(false);
    setRadarByTime({});
  }

  useEffect(() => {
    if (!launch) return;
    const current = ++token.current;
    const controller = new AbortController();
    setLoadingManifest(true);
    const params = new URLSearchParams({
      date: launch.date,
      west: String(launch.bounds.west),
      south: String(launch.bounds.south),
      east: String(launch.bounds.east),
      north: String(launch.bounds.north),
    });
    fetch(`/api/replay?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as ReplayManifest;
        if (!response.ok) throw new Error(payload.error ?? "That storm could not be replayed.");
        if (token.current !== current) return;
        setManifest(payload);
        setManifestError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || token.current !== current) return;
        setManifestError(error instanceof Error ? error.message : "That storm could not be replayed.");
      })
      .finally(() => {
        if (token.current === current) setLoadingManifest(false);
      });
    return () => controller.abort();
  }, [launch]);

  useEffect(() => {
    if (!playing || !manifest?.frames.length) return;
    const delay = Math.round((step === 60 ? 1100 : 800) / speed);
    const timer = window.setInterval(() => {
      setIndex((current) => {
        const next = current + strideFor(step);
        if (next >= manifest.frames.length) {
          setPlaying(false);
          return manifest.frames.length - 1;
        }
        return next;
      });
    }, delay);
    return () => window.clearInterval(timer);
  }, [playing, speed, step, manifest]);

  useEffect(() => {
    if (!launch || !manifest?.frames.length) return;
    const at = manifest.frames[Math.min(index, manifest.frames.length - 1)];
    if (!at || radarByTime[at]) return;
    const current = token.current;
    const controller = new AbortController();
    setRadarLoading(true);
    const params = new URLSearchParams({
      date: launch.date,
      at,
      west: String(launch.bounds.west),
      south: String(launch.bounds.south),
      east: String(launch.bounds.east),
      north: String(launch.bounds.north),
    });
    fetch(`/api/replay/frame?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as ReplayRadar;
        if (token.current !== current) return;
        setRadarByTime((prev) => (prev[at] ? prev : { ...prev, [at]: payload }));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted && token.current === current) setRadarLoading(false);
      });
    return () => controller.abort();
  }, [launch, manifest, index, radarByTime]);

  const frameCount = manifest?.frames.length ?? 0;
  const safeIndex = frameCount ? Math.min(index, frameCount - 1) : 0;
  const at = manifest?.frames[safeIndex] ?? null;
  let radar: ReplayRadar | null = null;
  if (manifest && at) {
    for (let cursor = safeIndex; cursor >= 0; cursor -= 1) {
      const hit = radarByTime[manifest.frames[cursor]];
      if (hit) {
        radar = hit;
        break;
      }
    }
  }

  function move(direction: -1 | 1) {
    if (!manifest?.frames.length) return;
    setIndex((current) => {
      const next = current + direction * strideFor(step);
      return Math.max(0, Math.min(manifest.frames.length - 1, next));
    });
  }

  return {
    active: launch != null,
    launch,
    manifest,
    manifestError,
    loadingManifest,
    index: safeIndex,
    at,
    playing,
    speed,
    step,
    radar: radar ?? { at: at ?? "", status: "empty" as const, note: "", collection: EMPTY, pulse: EMPTY },
    radarReady: Boolean(at && radarByTime[at]),
    radarLoading,
    start,
    stop,
    togglePlay: () => setPlaying((value) => !value),
    setSpeed,
    setStep,
    move,
    scrub: (next: number) => setIndex(next),
  };
}
