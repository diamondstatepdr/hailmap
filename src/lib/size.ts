const WORD_SIZES: Array<[RegExp, number]> = [
  [/\bsoft\s*balls?\b/i, 4.5],
  [/\bgrape\s*fruits?\b/i, 4],
  [/\btea\s*cups?\b/i, 3],
  [/\bbase\s*balls?\b/i, 2.75],
  [/\btennis(?:\s*balls?)?\b/i, 2.5],
  [/\bhen\s*eggs?\b|\beggs?\b/i, 2],
  [/\bgolf\s*balls?\b/i, 1.75],
  [/\bping[\s-]*pong(?:\s*balls?)?\b|\bwalnuts?\b/i, 1.5],
  [/\bhalf[\s-]*dollars?\b/i, 1.25],
  [/\bquarters?\b/i, 1],
  [/\bnickels?\b/i, 0.88],
  [/\b(?:penn(?:y|ies)|dimes?)\b/i, 0.75],
  [/\bmarbles?\b|\bmoth\s*balls?\b/i, 0.5],
  [/\bpeas?\b/i, 0.25],
];

const MAX_INCHES = 8;

function normalizeInches(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_INCHES) return null;
  return Math.round(value * 100) / 100;
}

/** Parse a hail size in inches from a number or spotter phrase. */
export function parseHailSizeInches(input: unknown): number | null {
  if (typeof input === "number") return normalizeInches(input);
  if (input == null) return null;
  const text = String(input).trim();
  if (!text) return null;

  const fraction = text.match(/(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const whole = fraction[1] ? Number(fraction[1]) : 0;
    const numerator = Number(fraction[2]);
    const denominator = Number(fraction[3]);
    if (denominator) return normalizeInches(whole + numerator / denominator);
  }

  let numericSource = text;
  if (numericSource.includes(",") && !numericSource.includes(".")) {
    numericSource = numericSource.replace(",", ".");
  }
  const numeric = numericSource.match(/-?\d+(?:\.\d+)?/);
  if (numeric) return normalizeInches(Number(numeric[0]));

  for (const [pattern, inches] of WORD_SIZES) {
    if (pattern.test(text)) return inches;
  }
  return null;
}

/**
 * SPC hail CSV stores size in hundredths of an inch (175 = 1.75).
 * Decimal tokens are already inches.
 */
export function parseSpcSizeToken(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.includes(".")) return parseHailSizeInches(text);
  const n = Number(text);
  if (!Number.isFinite(n)) return parseHailSizeInches(text);
  if (n >= 10) return parseHailSizeInches(n / 100);
  return parseHailSizeInches(n);
}
