import { haversineKm } from "@/lib/geo";
import { stateOf } from "@/lib/state-locate";

/** "About 3 miles": keeps a report a fraction past 3.0, and leaves 4 miles out. */
export const ABOUT_3_MI = 3.25;
export const MATCH_WINDOW_MS = 60 * 60 * 1000;
export const SEAL_MIN_IN = 1;
const MILES_PER_KM = 1.609344;

export const CONFIRM_DISCLAIMER =
  "Local Storm Reports are from NOAA. This is not a meteorologist certification and not an insurance decision.";

const STATE_ZONE: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DC: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  IA: "America/Chicago",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  MA: "America/New_York",
  MD: "America/New_York",
  ME: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MO: "America/Chicago",
  MS: "America/Chicago",
  MT: "America/Denver",
  NC: "America/New_York",
  ND: "America/Chicago",
  NE: "America/Chicago",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NV: "America/Los_Angeles",
  NY: "America/New_York",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VA: "America/New_York",
  VT: "America/New_York",
  WA: "America/Los_Angeles",
  WI: "America/Chicago",
  WV: "America/New_York",
  WY: "America/Denver",
};

export interface ProofSpotter {
  timeUtc: string;
  timeLocal: string;
  sizeIn: number;
  distanceMi: number;
  source: string;
  where: string;
}

export interface ProofConfirm {
  /** True only for a 2-minute scan of at least 1 inch with a matching Local Storm Report. */
  seal: boolean;
  headline: "Radar + spotter confirmed" | "Radar only";
  radarIn: number | null;
  radarAt: string | null;
  radarKind: "scan" | "daily" | "unavailable";
  radarLine: string;
  note: string;
  reports: ProofSpotter[];
  disclaimer: string;
}

export interface LsrHit {
  occurredAt: string;
  lat: number;
  lon: number;
  sizeIn: number;
  where: string;
  remark: string | null;
  observer: string | null;
  from: "spc" | "iem";
}

export function timeZoneAt(lat: number, lon: number): string {
  const state = stateOf(lat, lon);
  if (state && STATE_ZONE[state]) return STATE_ZONE[state];
  return "America/Chicago";
}

export function formatUtcStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function formatLocalStamp(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const zone = timeZone || "America/Chicago";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    return formatUtcStamp(iso);
  }
}

/** SPC comment text names the observer (mPING, spotter) and the office in parentheses. */
export function lsrSource(remark: string | null, observer: string | null, from: "spc" | "iem"): string {
  const blob = `${observer ?? ""} ${remark ?? ""}`.replace(/\s+/g, " ").trim();
  const parts = [from === "spc" ? "SPC Local Storm Report" : "NWS Local Storm Report"];
  if (/\bmping\b/i.test(blob)) parts.push("mPING");
  else if (/trained\s+spotter/i.test(blob)) parts.push("trained spotter");
  else if (/\bspotter\b/i.test(blob)) parts.push("spotter");
  else if (/broadcast media/i.test(blob)) parts.push("broadcast media");
  else if (/law enforcement/i.test(blob)) parts.push("law enforcement");
  else if (/\bpublic\b/i.test(blob)) parts.push("public");
  else if (/\bnws\b|national weather service/i.test(blob)) parts.push("NWS");
  const office = blob.match(/\(([A-Z]{3})\)/);
  if (office) parts.push(office[1]);
  return parts.join(" · ").slice(0, 90);
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function radarLineFor(input: {
  radarKind: ProofConfirm["radarKind"];
  radarIn: number | null;
  radarAt: string | null;
  timeZone: string;
}): string {
  if (!input.radarAt) return "Radar scan time is not available for this day.";
  const utc = formatUtcStamp(input.radarAt);
  const local = formatLocalStamp(input.radarAt, input.timeZone);
  const size = input.radarIn != null ? `${input.radarIn.toFixed(2)} in · ` : "";
  if (input.radarKind === "daily") return `24-hour radar maximum ending ${utc} · ${local}`;
  if (input.radarKind === "scan") return `Radar scan ${size}${utc} · ${local}`;
  return "Radar scan time is not available for this day.";
}

/**
 * Seal only when a 2-minute radar scan at the address is at least 1 inch
 * and at least one hail Local Storm Report is within about 3 miles and 1 hour.
 * A 24-hour maximum ending time never earns the seal.
 */
export function decideConfirmation(input: {
  lat: number;
  lon: number;
  timeZone?: string;
  radarIn: number | null;
  radarAt: string | null;
  radarKind: ProofConfirm["radarKind"];
  reports: LsrHit[];
}): ProofConfirm {
  const timeZone = input.timeZone || timeZoneAt(input.lat, input.lon);
  const radarIn = input.radarIn != null && Number.isFinite(input.radarIn) ? Math.round(input.radarIn * 100) / 100 : null;
  const radarMs = input.radarAt ? Date.parse(input.radarAt) : NaN;
  const canMatch = input.radarKind === "scan" && Number.isFinite(radarMs);
  const matches = canMatch
    ? input.reports
        .flatMap((report) => {
          const when = Date.parse(report.occurredAt);
          if (!Number.isFinite(when) || Math.abs(when - radarMs) > MATCH_WINDOW_MS) return [];
          if (report.sizeIn == null || report.sizeIn <= 0) return [];
          const distanceMi = haversineKm(input.lat, input.lon, report.lat, report.lon) / MILES_PER_KM;
          if (distanceMi > ABOUT_3_MI) return [];
          const where = clip(report.where, 80) || "Nearby";
          return [
            {
              timeUtc: formatUtcStamp(report.occurredAt),
              timeLocal: formatLocalStamp(report.occurredAt, timeZone),
              sizeIn: Math.round(report.sizeIn * 100) / 100,
              distanceMi: Math.round(distanceMi * 10) / 10,
              source: lsrSource(report.remark, report.observer, report.from),
              where,
              sortMi: distanceMi,
              sortMs: when,
            },
          ];
        })
        .sort((a, b) => a.sortMi - b.sortMi || a.sortMs - b.sortMs)
        .slice(0, 6)
        .map(({ sortMi: _sortMi, sortMs: _sortMs, ...report }) => report)
    : [];

  const seal = input.radarKind === "scan" && radarIn != null && radarIn >= SEAL_MIN_IN && matches.length > 0;
  let note = "";
  if (input.radarKind === "daily") {
    note = "This time is the 24-hour radar maximum ending then, not one scan, so there is no seal.";
  } else if (input.radarKind === "scan" && !Number.isFinite(radarMs)) {
    note = "Radar scans for this day stayed under 0.05 in at this address.";
  } else if (input.radarKind !== "scan") {
    note = "The 2-minute radar scan is not available for this day, so spotter reports were not matched to a scan.";
  } else if (!matches.length) {
    note = "No Local Storm Report within about 3 mi and 1 hour of the radar scan.";
  } else if (radarIn == null || radarIn < SEAL_MIN_IN) {
    note = "Spotter reports are listed. Radar hail is under 1 inch, so there is no seal.";
  }

  return {
    seal,
    headline: seal ? "Radar + spotter confirmed" : "Radar only",
    radarIn,
    radarAt: input.radarAt,
    radarKind: input.radarKind,
    radarLine: radarLineFor({ radarKind: input.radarKind, radarIn, radarAt: input.radarAt, timeZone }),
    note,
    reports: matches,
    disclaimer: CONFIRM_DISCLAIMER,
  };
}

export function parseProofConfirm(value: unknown): ProofConfirm | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const radarKind = row.radarKind === "scan" || row.radarKind === "daily" || row.radarKind === "unavailable" ? row.radarKind : "unavailable";
  const radarInRaw = Number(row.radarIn);
  const radarIn = Number.isFinite(radarInRaw) && radarInRaw > 0 && radarInRaw <= 8 ? Math.round(radarInRaw * 100) / 100 : null;
  const radarAt = typeof row.radarAt === "string" && !Number.isNaN(Date.parse(row.radarAt)) ? new Date(row.radarAt).toISOString() : null;
  const reports = (Array.isArray(row.reports) ? row.reports : []).slice(0, 6).flatMap((item) => {
    const report = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const sizeIn = Number(report.sizeIn);
    const distanceMi = Number(report.distanceMi);
    const timeUtc = clip(String(report.timeUtc ?? ""), 40);
    const timeLocal = clip(String(report.timeLocal ?? ""), 40);
    const source = clip(String(report.source ?? ""), 90);
    const where = clip(String(report.where ?? ""), 80);
    if (!timeUtc || !Number.isFinite(sizeIn) || sizeIn <= 0 || !Number.isFinite(distanceMi) || distanceMi > ABOUT_3_MI + 0.06) return [];
    return [{ timeUtc, timeLocal: timeLocal || timeUtc, sizeIn: Math.round(sizeIn * 100) / 100, distanceMi: Math.round(distanceMi * 10) / 10, source: source || "Local Storm Report", where: where || "Nearby" }];
  });
  const seal = radarKind === "scan" && radarIn != null && radarIn >= SEAL_MIN_IN && reports.length > 0;
  const timeZone = "UTC";
  return {
    seal,
    headline: seal ? "Radar + spotter confirmed" : "Radar only",
    radarIn,
    radarAt,
    radarKind,
    radarLine: clip(String(row.radarLine ?? ""), 160) || radarLineFor({ radarKind, radarIn, radarAt, timeZone }),
    note: clip(String(row.note ?? ""), 220),
    reports,
    disclaimer: CONFIRM_DISCLAIMER,
  };
}

export function unavailableConfirm(note = "The 2-minute radar scan is not available for this day, so spotter reports were not matched to a scan."): ProofConfirm {
  return {
    seal: false,
    headline: "Radar only",
    radarIn: null,
    radarAt: null,
    radarKind: "unavailable",
    radarLine: "Radar scan time is not available for this day.",
    note,
    reports: [],
    disclaimer: CONFIRM_DISCLAIMER,
  };
}
