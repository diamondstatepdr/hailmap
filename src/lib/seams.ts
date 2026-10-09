/**
 * Later phase. Roof records and an AI storm briefing are not implemented.
 * UI and routes should check these flags instead of inventing those answers.
 */
export const laterPhase = {
  askAboutStorms: false,
  roofAndPropertyIntelligence: false,
} as const;
