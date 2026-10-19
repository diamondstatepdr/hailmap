"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { HailReport } from "@/lib/types";
import { loadedFrameIndex, prefetchFrameTimes, type ReplayBounds } from "@/lib/replay-time";

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
const MAX_IN_FLIGHT = 3;

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
  const inflight = useRef(new Map<string, AbortController>());
  const radarRef = useRef(radarByTime);
  radarRef.current = radarByTime;

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
    const pending = inflight.current;
    return () => {
      for (const controller of pending.values()) controller.abort();
      pending.clear();
    };
  }, [launch]);

  useEffect(() => {
    if (!playing || !manifest?.frames.length) return;
    const frames = manifest.frames;
    const currentIndex = Math.min(index, frames.length - 1);
    const at = frames[currentIndex];
    const nextIndex = currentIndex + strideFor(step);
    const nextAt = nextIndex < frames.length ? frames[nextIndex] : null;
    // Stay on a frame until its swath is stored, and don't step onto the next one early.
    if (!at || !radarByTime[at] || (nextAt && !radarByTime[nextAt])) return;
    const delay = Math.round((step === 60 ? 1100 : 800) / speed);
    const timer = window.setTimeout(() => {
      setIndex((current) => {
        const next = current + strideFor(step);
        if (next >= frames.length) {
          setPlaying(false);
          return frames.length - 1;
        }
        return next;
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [playing, speed, step, manifest, index, radarByTime]);

  useEffect(() => {
    if (!launch || !manifest?.frames.length) return;
    const generation = token.current;
    const wanted = prefetchFrameTimes(manifest.frames, index, step);
    const startOne = (at: string) => {
      if (radarRef.current[at] || inflight.current.has(at) || inflight.current.size >= MAX_IN_FLIGHT) return false;
      const controller = new AbortController();
      inflight.current.set(at, controller);
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
          if (controller.signal.aborted || token.current !== generation) return;
          setRadarByTime((prev) => (prev[at] ? prev : { ...prev, [at]: payload }));
        })
        .catch(() => {
          if (controller.signal.aborted || token.current !== generation) return;
          setRadarByTime((prev) =>
            prev[at]
              ? prev
              : {
                  ...prev,
                  [at]: { at, status: "error", note: "That radar scan could not be read.", collection: EMPTY, pulse: EMPTY },
                },
          );
        })
        .finally(() => {
          if (inflight.current.get(at) === controller) inflight.current.delete(at);
          if (token.current === generation) setRadarLoading(inflight.current.size > 0);
        });
      return true;
    };

    // A jump can leave earlier scans in flight. Drop one that is outside the new
    // window so the frame on screen is not stuck behind scans the playhead left.
    const requested = wanted[0];
    if (requested && !radarRef.current[requested] && !inflight.current.has(requested) && inflight.current.size >= MAX_IN_FLIGHT) {
      for (const [at, controller] of inflight.current) {
        if (wanted.includes(at)) continue;
        controller.abort();
        inflight.current.delete(at);
        break;
      }
    }
    for (const at of wanted) startOne(at);
    const requestedReady = Boolean(requested && radarRef.current[requested]);
    setRadarLoading(!requestedReady && (inflight.current.size > 0 || Boolean(requested)));
  }, [launch, manifest, index, step, radarByTime]);

  const frameCount = manifest?.frames.length ?? 0;
  const safeIndex = frameCount ? Math.min(index, frameCount - 1) : 0;
  const requestedAt = manifest?.frames[safeIndex] ?? null;
  const shownIndex = manifest ? loadedFrameIndex(manifest.frames, safeIndex, (time) => Boolean(radarByTime[time])) : -1;
  const at = shownIndex >= 0 && manifest ? manifest.frames[shownIndex] : null;
  const radar = at ? radarByTime[at] ?? null : null;

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
    radarReady: Boolean(requestedAt && radarByTime[requestedAt]),
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
