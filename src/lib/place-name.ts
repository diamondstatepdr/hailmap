/** Restore a city name that lost its last letter. "Flagstaf" is Flagstaff. */
export function repairPlaceName(name: string): string {
  return name.replace(/\bflagstaf\b/gi, (match) => {
    if (match === match.toUpperCase()) return "FLAGSTAFF";
    if (match[0] === match[0]?.toUpperCase()) return "Flagstaff";
    return "flagstaff";
  });
}
