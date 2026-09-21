const TAGS: Array<{ tag: string; re: RegExp }> = [
  { tag: "vehicle", re: /\b(vehicles?|cars?|autos?|trucks?|windshields?|hoods?)\b/i },
  { tag: "roof", re: /\b(roofs?|shingles?)\b/i },
  { tag: "window", re: /\b(windows?|windshields?|glass|skylights?)\b/i },
  { tag: "crop", re: /\b(crops?|corn|wheat|soybeans?|farmland)\b/i },
  { tag: "siding", re: /\b(siding|vinyl)\b/i },
  { tag: "tree", re: /\b(trees?|limbs?|branches)\b/i },
  { tag: "power", re: /\b(power\s*lines?|outages?|transformers?|utility\s*poles?)\b/i },
  { tag: "injury", re: /\b(injur(?:y|ies|ed)|fatalit(?:y|ies)|killed|hurt)\b/i },
  { tag: "structure", re: /\b(buildings?|houses?|barns?|structures?|garages?)\b/i },
];

export const DAMAGE_TAGS = TAGS.map((entry) => entry.tag);

export function sortDamageTags(tags: Iterable<string>): string[] {
  const present = new Set(tags);
  return DAMAGE_TAGS.filter((tag) => present.has(tag));
}

/** Pull canonical damage tags out of a free-text hail remark. */
export function extractDamageTags(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const { tag, re } of TAGS) {
    if (re.test(text)) found.push(tag);
  }
  return found;
}
