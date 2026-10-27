"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import { hailYearIntent } from "@/lib/hail-year";
import { repairPlaceName } from "@/lib/place-name";

export interface AddressHit {
  label: string;
  lat: number;
  lon: number;
  city: string | null;
  state: string | null;
}

interface Props {
  onPick: (hit: AddressHit) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Increment to close the suggestion list, including a search that is still in flight. */
  closeSignal?: number;
  /** Open the year list from the map search. */
  onBrowseYears?: () => void;
  /** Open one calendar year of hail from the map search. */
  onHailYear?: (year: number) => void;
}

export default function AddressSearch({
  onPick,
  placeholder = "Address, city, or ZIP",
  autoFocus = false,
  closeSignal = 0,
  onBrowseYears,
  onHailYear,
}: Props) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const request = useRef(0);
  const pinnedQuery = useRef<string | null>(null);
  const inputId = useId();

  function pick(hit: AddressHit) {
    const repaired = { ...hit, label: repairPlaceName(hit.label), city: hit.city ? repairPlaceName(hit.city) : hit.city };
    pinnedQuery.current = repaired.label;
    request.current += 1;
    setQuery(repaired.label);
    setHits([]);
    setStatus("idle");
    setFocused(false);
    onPick(repaired);
  }

  function chooseYears() {
    request.current += 1;
    setQuery("");
    setHits([]);
    setStatus("idle");
    setFocused(false);
    onBrowseYears?.();
  }

  function chooseYear(year: number) {
    request.current += 1;
    setQuery("");
    setHits([]);
    setStatus("idle");
    setFocused(false);
    onHailYear?.(year);
  }

  useEffect(() => {
    request.current += 1;
    setHits([]);
    setStatus("idle");
  }, [closeSignal]);

  useEffect(() => {
    const trimmed = query.trim();
    if (pinnedQuery.current === trimmed) return;
    pinnedQuery.current = null;
    if (hailYearIntent(trimmed)) {
      setHits([]);
      setStatus("idle");
      return;
    }
    if (trimmed.length < 3) {
      setHits([]);
      setStatus("idle");
      return;
    }
    const id = ++request.current;
    const timer = window.setTimeout(() => {
      setStatus("loading");
      fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`)
        .then(async (response) => {
          const payload = (await response.json()) as { places?: AddressHit[]; error?: string };
          if (request.current !== id) return;
          if (!response.ok) throw new Error(payload.error ?? "Search failed");
          setHits(payload.places ?? []);
          setStatus(payload.places?.length ? "idle" : "empty");
        })
        .catch(() => {
          if (request.current !== id) return;
          setHits([]);
          setStatus("error");
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const intent = hailYearIntent(query);
  const showBrowse = Boolean(onBrowseYears) && intent?.kind !== "year" && (intent?.kind === "browse" || (focused && query.trim().length === 0));
  const yearPick = intent?.kind === "year" && onHailYear ? intent.year : null;
  const yearActions = [
    ...(showBrowse ? [{ label: "Hail by year", onClick: chooseYears }] : []),
    ...(yearPick != null ? [{ label: `Hail in ${yearPick}`, onClick: () => chooseYear(yearPick) }] : []),
  ];

  return (
    <div className="address-search">
      <label className="sr-only" htmlFor={inputId}>
        Search an address
      </label>
      <div className="relative">
        <Search size={20} strokeWidth={2.4} className="address-search-icon" aria-hidden />
        <input
          id={inputId}
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder}
          enterKeyHint="search"
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (hits[0]) {
              event.preventDefault();
              pick(hits[0]);
              return;
            }
            const action = yearActions[0];
            if (action) {
              event.preventDefault();
              action.onClick();
            }
          }}
          className="address-search-input glass w-full rounded-2xl py-2.5 pr-3 outline-none"
        />
      </div>
      {status === "loading" ? <p className="px-1 pt-1 text-xs text-muted">Searching…</p> : null}
      {status === "error" ? <p className="px-1 pt-1 text-xs text-muted">Address search is unavailable right now.</p> : null}
      {status === "empty" && !hailYearIntent(query) ? <p className="px-1 pt-1 text-xs text-muted">No matching US address.</p> : null}
      {yearActions.length ? (
        <ul className="address-search-list absolute z-30 mt-1 w-full overflow-auto rounded-2xl border border-line bg-panel shadow-float">
          {yearActions.map((action) => (
            <li key={action.label}>
              <button
                type="button"
                className="tap block w-full px-3 text-left text-sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {hits.length ? (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-line bg-panel shadow-float">
          {hits.map((hit) => (
            <li key={`${hit.lat},${hit.lon},${hit.label}`}>
              <button
                type="button"
                className="tap block w-full px-3 text-left text-sm hover:bg-app"
                onClick={() => pick(hit)}
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
