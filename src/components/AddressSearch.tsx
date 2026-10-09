"use client";

import { useEffect, useState } from "react";

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
}

export default function AddressSearch({ onPick, placeholder = "Address, city, or ZIP", autoFocus = false }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setHits([]);
      setStatus("idle");
      return;
    }
    const timer = window.setTimeout(() => {
      setStatus("loading");
      fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`)
        .then(async (response) => {
          const payload = (await response.json()) as { places?: AddressHit[]; error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Search failed");
          setHits(payload.places ?? []);
          setStatus(payload.places?.length ? "idle" : "empty");
        })
        .catch(() => {
          setHits([]);
          setStatus("error");
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <div className="relative min-w-0 flex-1">
      <label className="sr-only" htmlFor="address-search">
        Search an address
      </label>
      <input
        id="address-search"
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-2xl border border-line bg-panel px-3 py-2 text-sm shadow-sheet outline-none"
      />
      {status === "loading" ? <p className="px-1 pt-1 text-xs text-muted">Searching…</p> : null}
      {status === "error" ? (
        <p className="px-1 pt-1 text-xs text-muted">Address search is unavailable right now.</p>
      ) : null}
      {status === "empty" ? <p className="px-1 pt-1 text-xs text-muted">No matching US address.</p> : null}
      {hits.length ? (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-line bg-panel shadow-sheet">
          {hits.map((hit) => (
            <li key={`${hit.lat},${hit.lon},${hit.label}`}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-app"
                onClick={() => {
                  setQuery(hit.label);
                  setHits([]);
                  onPick(hit);
                }}
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
