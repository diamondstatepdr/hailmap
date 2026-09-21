export const CONFIDENCE_RANK = {
  nws: 4,
  spotter: 3,
  mesh: 2,
  community: 1,
} as const;

export type Confidence = keyof typeof CONFIDENCE_RANK;

export function confidenceRank(confidence: Confidence): number {
  return CONFIDENCE_RANK[confidence];
}

export function asConfidence(value: unknown): Confidence | null {
  if (value === "nws" || value === "spotter" || value === "mesh" || value === "community") {
    return value;
  }
  return null;
}

const NWS_OBSERVER =
  /\bnws\b|national weather service|official nws|\basos\b|\bawos\b|\bmesonet\b|law enforcement|emergency mngr|emergency manager/;

const SPOTTER_OBSERVER =
  /trained\s+spotter|\bspotter\b|spotter network|cocorahs|co-?op observer|broadcast media|storm chaser|amateur radio|\bpublic\b|\bmping\b|social\s*media|\bfacebook\b|\btwitter\b|\binstagram\b/;

function observerRank(text: string | null | undefined): "nws" | "spotter" | null {
  if (!text) return null;
  const blob = text.toLowerCase();
  if (NWS_OBSERVER.test(blob)) return "nws";
  if (SPOTTER_OBSERVER.test(blob)) return "spotter";
  return null;
}

/**
 * Confidence for an official NWS product: SPC hail reports and IEM local storm reports.
 * A bulletin that mentions the public, mPING, or social media is still an office LSR,
 * so it stays spotter (or nws when the observer is the office, ASOS/AWOS, law
 * enforcement, or an emergency manager). It is never community or MESH.
 * A radar time estimate in the remark does not by itself raise the rank.
 * Imports and webhooks use confidenceForImport instead.
 */
export function classifyOfficialLsr(
  source: string | null | undefined,
  remark: string | null | undefined,
): Confidence {
  const fromSource = observerRank(source);
  const fromRemark = observerRank(remark);
  if (fromSource === "nws" || fromRemark === "nws") return "nws";
  return "spotter";
}

/** Imports and webhooks cannot claim official NWS or MESH confidence. */
export function confidenceForImport(value: unknown): Confidence {
  const parsed = asConfidence(typeof value === "string" ? value.trim().toLowerCase() : value);
  if (parsed === "spotter" || parsed === "community") return parsed;
  return "community";
}
