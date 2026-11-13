/** Sales copy for the pricing and sign-up pages. Each feature maps to code that ships. */

export const TRIAL_LABEL = "7-day free trial";
export const TRIAL_BUTTON = "Start 7-day free trial";

export const PITCH_TITLE = "See where the hail hit. Then go get the work.";

export const PITCH_LEDE =
  "Swathline is the hail map for paintless dent repair. Live swaths show the storm you are on. Storm history shows what already fell. Look up an address before you knock.";

export const PITCH_FREE = "The live map, address history, and storm replay stay free.";

export const PITCH_PAID = "A plan opens the tools you use to work the storm.";

export const SIGNUP_LEDE =
  "One login for you. The live hail map stays free. Sales tools come with a plan, and every plan starts with a 7-day free trial.";

export const PITCH_FEATURES = [
  {
    title: "Live hail swaths",
    detail: "Radar and report swaths for the hail on the ground.",
    source: "src/lib/swath.ts",
  },
  {
    title: "Storm history",
    detail: "Past hail at an address, back through the archive.",
    source: "src/lib/history-query.ts",
  },
  {
    title: "Address lookup",
    detail: "Type an address and see what hit it.",
    source: "src/lib/address-lookup.ts",
  },
  {
    title: "Door-knock routes",
    detail: "Streets under the hail, hardest hit first, in one walk.",
    source: "src/lib/knock-route.ts",
  },
  {
    title: "Dealership hit list",
    detail: "Dealers and auto lots in the swath, ranked by hail size.",
    source: "src/lib/dealers.ts",
  },
  {
    title: "Hail proof PDFs",
    detail: "Storm dates, hail size, and a swath map for that address.",
    source: "src/lib/hail-proof.ts",
  },
  {
    title: "Canvass tracker",
    detail: "Mark a house knocked, not home, interested, or signed.",
    source: "src/lib/canvass.ts",
  },
  {
    title: "Storm-to-cash",
    detail: "An estimate of the cars and roofs in the swath. An estimate, not a promise.",
    source: "src/lib/forecast.ts",
  },
  {
    title: "Lead export",
    detail: "Download interested and signed leads.",
    source: "src/lib/leads.ts",
  },
] as const;
