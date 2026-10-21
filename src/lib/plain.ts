/** First-run and plain-language copy. Safe to import from client components. */

export const WELCOME_KEY = "swathline-welcome-seen";
export const WELCOME_SESSION_KEY = "swathline-welcome-session";

export const WELCOME_SCREENS = [
  {
    id: "see",
    title: "See where hail hit",
    body: "Colored bands on the map are the hail path. Greener is smaller. Pink is the biggest.",
  },
  {
    id: "money",
    title: "Find the best money spots",
    body: "Chase List ranks this week's storms. Money spots lists the lots and neighborhoods under the hail.",
  },
  {
    id: "work",
    title: "Work the area",
    body: "Search an address, open a storm, and go. Colors, filters, and the rest live in Menu.",
  },
] as const;

export const SCORE_TIP =
  "Money Hole score ranks where to work. A higher number means more cars or homes sat under bigger hail. It is not a dollar amount.";

export const RADAR_TIP =
  "Radar size is an estimate from weather radar. Spotter size is what a person on the ground reported. When both exist, they are shown side by side.";

export const PATH_TIP = "A hail path (also called a swath) is the strip of ground the storm covered.";

/** A share link already chose a place. Don't cover it with the intro. */
export function shouldShowWelcome(stored: string | null, search: string): boolean {
  if (stored === "1") return false;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("day") || params.get("date") || params.get("lat") || params.get("reportId") || params.get("replay") === "1" || params.get("honey") === "1") {
    return false;
  }
  return true;
}

/** The weekly chase sheet waits until the intro is finished, including the rest of that visit. */
export function welcomeBlocksChase(welcomeOpen: boolean, sessionDone: string | null): boolean {
  return welcomeOpen || sessionDone === "1";
}

/** The default week reads as the hail chip, not a filter code. */
export function friendlyWhen(label: string): string {
  if (label === "All storms · 7 days") return "Hail · 7 days";
  return label.replace(/^All storms · /, "Hail · ");
}

/** The map chip keeps the time, short enough to stay at 15px. */
export function chipWhen(label: string): string {
  const friendly = friendlyWhen(label);
  const parts = friendly.split(" · ");
  return parts[parts.length - 1] || friendly;
}

/** One readable money-spot line. 2.23" becomes 2.2"; quarter inches stay. */
export function formatHoneyDetail(input: {
  radarIn?: number | null;
  spotterIn?: number | null;
  hailIn?: number | null;
  count?: number | null;
  noun: "cars" | "homes";
}): string {
  const inches = (value: number) => {
    const tenths = Math.round(value * 10) / 10;
    if (Math.abs(value - tenths) < 0.05) {
      return Number.isInteger(tenths) ? `${tenths.toFixed(0)}"` : `${tenths.toFixed(1)}"`;
    }
    return `${(Math.round(value * 100) / 100).toFixed(2)}"`;
  };
  const bits: string[] = [];
  if (input.radarIn != null && input.radarIn > 0) bits.push(`${inches(input.radarIn)} radar`);
  if (input.spotterIn != null && input.spotterIn > 0) bits.push(`${inches(input.spotterIn)} spotter`);
  if (!bits.length && input.hailIn != null && input.hailIn > 0) bits.push(`${inches(input.hailIn)} hail`);
  const hail = bits.length ? `Hail: ${bits.join(", ")}` : "Hail size not in yet";
  if (input.count == null) return hail;
  const word = input.count === 1 ? (input.noun === "cars" ? "car" : "home") : input.noun;
  return `${hail} · ${input.count.toLocaleString("en-US")} ${word}`;
}
