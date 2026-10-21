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

/** The default week reads as a sentence, not a filter code. */
export function friendlyWhen(label: string): string {
  if (label === "All storms · 7 days") return "This week";
  return label.replace(/^All storms · /, "");
}
