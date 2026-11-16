/** First-run and plain-language copy. Safe to import from client components. */

export const WELCOME_KEY = "swathline-welcome-seen";
export const WELCOME_SESSION_KEY = "swathline-welcome-session";
export const INTRO_COOKIE = "swathline_intro";

/** One screen, about five seconds, before the map. */
export const INTRO = {
  kicker: "For PDR techs and crews",
  title: "Live hail across the US.",
  body: "Swaths and reports on the map. Then the tools that turn a hail day into work.",
  tools: ["Door-knock routes", "Canvass tracker", "Dealership hit list", "Hail-proof PDF", "Storm-to-cash", "Lead export"],
  price:
    "Solo $15 for one person. Crew $119 for up to 5. Storm Team $249 for up to 15. 7 days free, card up front. The map stays free.",
  map: "Open the free map",
  trial: "Start free trial",
  towns: ["Amarillo", "Lubbock", "Wichita"],
} as const;

export function introSeenCookie(secure: boolean): string {
  return `${INTRO_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const SCORE_TIP =
  "Money Hole score ranks where to work. A higher number means more cars or homes sat under bigger hail. It is not a dollar amount.";

export const RADAR_TIP =
  "Radar size is an estimate from weather radar. Spotter size is what a person on the ground reported. When both exist, they are shown side by side.";

export const PATH_TIP = "A hail path (also called a swath) is the strip of ground the storm covered.";

/** A share link, a signed-in session, or a return visit goes straight to the map. */
export function shouldShowWelcome(stored: string | null, search: string, signedIn = false): boolean {
  if (signedIn || stored === "1") return false;
  if (searchSkipsIntro(search)) return false;
  return true;
}

/** Map, alert, and sign-in links already chose a place. Theme alone does not. */
export function searchSkipsIntro(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("day") || params.get("date") || params.get("lat") || params.get("reportId") || params.get("signin")) return true;
  if (params.get("replay") === "1" || params.get("honey") === "1") return true;
  if (params.get("card") === "address" || params.get("section") === "alerts") return true;
  if (params.get("focusLat") && params.get("focusLon")) return true;
  if (params.get("west") && params.get("south") && params.get("east") && params.get("north")) return true;
  return false;
}

/** Hide a server-rendered intro before paint when this browser has already seen it or opened a deep link. */
export function introBootScript(): string {
  const key = JSON.stringify(WELCOME_KEY);
  const cookie = JSON.stringify(`${INTRO_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax`);
  return `(function(){try{var seen=localStorage.getItem(${key})==="1";var p=new URLSearchParams(location.search);var deep=p.get("day")||p.get("date")||p.get("lat")||p.get("reportId")||p.get("signin")||p.get("replay")==="1"||p.get("honey")==="1"||p.get("card")==="address"||p.get("section")==="alerts"||(p.get("focusLat")&&p.get("focusLon"))||(p.get("west")&&p.get("south")&&p.get("east")&&p.get("north"));if(seen||deep){document.documentElement.setAttribute("data-intro","skip");if(seen)document.cookie=${cookie}+(location.protocol==="https:"?"; Secure":"");}}catch(e){}})();`;
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
