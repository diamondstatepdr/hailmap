/** Clock time in a time zone, with a short zone label such as "1:13 PM CDT". */
export function formatSentClock(at: string, timeZone?: string): string | null {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(when);
}
