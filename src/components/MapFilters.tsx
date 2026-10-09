"use client";

import { CONFIDENCE_OPTIONS, type ReportFilter } from "@/components/map-shared";
import { OUTLOOK_LEVELS, SIGNIFICANT_COLOR, THREAT_LEGEND, type ThreatsResponse } from "@/lib/threats";
import type { Confidence } from "@/lib/confidence";
import type { SourceStatus } from "@/lib/types";
import { formatWhen } from "@/lib/filters";

interface Props {
  filter: ReportFilter;
  onFilter: (filter: ReportFilter) => void;
  onToggleConfidence: (id: Confidence) => void;
  showPoints: boolean;
  showSwaths: boolean;
  showThreats: boolean;
  showOutlook: boolean;
  showIncome: boolean;
  showHeat: boolean;
  onToggle: (key: "points" | "swaths" | "threats" | "outlook" | "income" | "heat") => void;
  incomeError: boolean;
  threatError: boolean;
  threatStatus: ThreatsResponse["status"] | null;
  status: SourceStatus | null;
  syncedAt: string | null;
  folded: number;
  importNote: string | null;
  onImport: (file: File) => void;
  onCommunityPhoto: () => void;
  onClose: () => void;
}

export default function MapFilters(props: Props) {
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/40 backdrop-blur-[2px]" onClick={props.onClose}>
      <div className="sheet max-h-[80dvh] w-full overflow-y-auto px-4 pb-5 pt-1" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="mb-3 mt-2 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Filters and layers</h2>
          <button type="button" onClick={props.onClose} className="btn btn-primary press px-3 py-1.5 text-xs">
            Done
          </button>
        </div>
        <label className="block text-sm">
          <span className="font-medium">Smallest hail to show</span>
          <span className="mt-1 block text-muted">
            {props.filter.minSize <= 0 ? "Any size" : `${props.filter.minSize.toFixed(2)} in and larger`}. Wind and tornado stay visible.
          </span>
          <input
            type="range"
            min={0}
            max={4}
            step={0.25}
            value={props.filter.minSize}
            onChange={(event) => props.onFilter({ ...props.filter, minSize: Number(event.target.value) })}
            className="mt-3 w-full"
          />
        </label>
        <div className="mt-4">
          <p className="text-sm font-medium">Report sources</p>
          <p className="mb-2 text-xs text-muted">
            Official reports come from the weather service. Radar is an estimate. Community is a file, a private feed, or a photo you add here.
          </p>
          <div className="flex flex-wrap gap-2">
            {CONFIDENCE_OPTIONS.map((option) => {
              const on = props.filter.confidences.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => props.onToggleConfidence(option.id)}
                  className={`press rounded-full px-3 py-1.5 text-sm ${on ? "chip-on" : "chip shadow-none"}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Map layers</p>
          <div className="flex flex-wrap gap-2">
            <Toggle on={props.showPoints} label="Reports" onClick={() => props.onToggle("points")} />
            <Toggle on={props.showSwaths} label="Hail swaths" onClick={() => props.onToggle("swaths")} />
            <Toggle on={props.showHeat} label="Damage areas" onClick={() => props.onToggle("heat")} />
            <Toggle on={props.showThreats} label="Threats" onClick={() => props.onToggle("threats")} />
            <Toggle on={props.showOutlook} label="Outlook" onClick={() => props.onToggle("outlook")} />
            <Toggle on={props.showIncome} label="County income" onClick={() => props.onToggle("income")} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Damage areas use the same score as an address, on a coarse grid. Hail swaths group nearby hail reports.
            {props.showIncome && props.incomeError ? " Income data is unavailable right now." : ""}
            {props.showThreats && (props.threatError || props.threatStatus?.nws === "error")
              ? " Watches and warnings are unavailable right now."
              : ""}
            {props.showOutlook && (props.threatError || props.threatStatus?.spc === "error")
              ? " The Day 1 outlook is unavailable right now."
              : ""}
            {props.status?.mesh === "skipped" ? " Radar MESH is off until HAILMAP_MESH_URL is set." : ""}
          </p>
          {props.showOutlook ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {OUTLOOK_LEVELS.map((level) => (
                <Swatch key={level.category} label={level.label} fill={level.fill} />
              ))}
              <Swatch label="Significant" fill={SIGNIFICANT_COLOR} dashed />
            </div>
          ) : null}
          {props.showThreats ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {THREAT_LEGEND.map((item) => (
                <Swatch key={item.event} label={item.label} fill={item.fill} dashed={item.dashed} />
              ))}
            </div>
          ) : null}
        </div>
        <label className="mt-4 block text-sm">
          <span className="font-medium">State code</span>
          <input
            value={props.filter.state}
            maxLength={2}
            placeholder="Any"
            aria-label="State code"
            onChange={(event) =>
              props.onFilter({
                ...props.filter,
                state: event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2),
              })
            }
            className="mt-1 w-24 rounded-xl border border-line bg-app px-3 py-2 uppercase"
          />
        </label>
        <div className="mt-4">
          <button type="button" onClick={props.onCommunityPhoto} className="btn btn-secondary press w-full">
            Add a community hail photo
          </button>
          <p className="mt-1 text-xs text-muted">Public pin. It is not an official report, and it is separate from Field photos.</p>
        </div>
        <label className="mt-4 block text-sm">
          <span className="font-medium">Add reports from a file</span>
          <span className="mb-1 block text-xs text-muted">CSV or GeoJSON. This does not read social media.</span>
          <input
            type="file"
            accept=".csv,.json,.geojson,text/csv,application/json,application/geo+json"
            className="block w-full text-sm text-muted"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onImport(file);
              event.target.value = "";
            }}
          />
          {props.importNote ? <span className="mt-1 block text-xs text-muted">{props.importNote}</span> : null}
        </label>
        <p className="mt-4 text-xs leading-relaxed text-muted">
          SPC {props.status?.spc ?? "checking"} · IEM {props.status?.iem ?? "checking"} · NWS {props.status?.nws ?? "checking"} · MESH{" "}
          {props.status?.mesh ?? "checking"}
          {props.syncedAt ? ` · Updated ${formatWhen(props.syncedAt)}` : ""}
          {props.folded > 0 ? ` · ${props.folded} nearby reports were combined.` : ""} Published local storm reports stay Official or Spotter. HailMap does not scrape social networks.
        </p>
      </div>
    </div>
  );
}

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`press rounded-full px-3 py-1.5 text-sm ${on ? "chip-on" : "chip shadow-none"}`}
    >
      {label}
    </button>
  );
}

function Swatch({ label, fill, dashed = false }: { label: string; fill: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{
          background: dashed ? "transparent" : fill,
          border: `2px ${dashed ? "dashed" : "solid"} ${fill}`,
        }}
      />
      {label}
    </span>
  );
}
