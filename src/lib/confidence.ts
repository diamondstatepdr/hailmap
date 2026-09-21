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

/**
 * Rank a text source/remark from an official feed.
 * Community signals (public, social, mPING) are checked before office keywords
 * so a remark that merely mentions radar still stays community when the
 * observer was the public. This does not scrape any social network.
 */
export function classifyObservation(
  source: string | null | undefined,
  remark: string | null | undefined,
): Confidence {
  const blob = `${source ?? ""} ${remark ?? ""}`.toLowerCase();
  if (/\bmrms\b|\bmesh\b/.test(blob)) return "mesh";
  if (/social\s*media|\bpublic\b|\bmping\b|\bfacebook\b|\btwitter\b|\binstagram\b|\bx\.com\b/.test(blob)) {
    return "community";
  }
  if (/spotter|cocorahs|co-?op observer|\bbroadcast\b|\bmedia\b/.test(blob)) return "spotter";
  if (
    /\bnws\b|national weather|official|\basos\b|\bawos\b|mesonet|law enforcement|emergency|radar|meteorologist|measured/.test(
      blob,
    )
  ) {
    return "nws";
  }
  return "spotter";
}

/** Imports and webhooks cannot claim official NWS or MESH confidence. */
export function confidenceForImport(value: unknown): Confidence {
  const parsed = asConfidence(typeof value === "string" ? value.trim().toLowerCase() : value);
  if (parsed === "spotter" || parsed === "community") return parsed;
  return "community";
}
