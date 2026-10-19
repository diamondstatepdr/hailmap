const nextAt = new Map<string, number>();
const tail = new Map<string, Promise<void>>();

/** One in-flight request per host, with a gap after each one. */
export function pace<T>(host: string, gapMs: number, run: () => Promise<T>): Promise<T> {
  const previous = tail.get(host) ?? Promise.resolve();
  const job = previous.then(async () => {
    const wait = (nextAt.get(host) ?? 0) - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await run();
    } finally {
      nextAt.set(host, Date.now() + gapMs);
    }
  });
  tail.set(
    host,
    job.then(
      () => undefined,
      () => undefined,
    ),
  );
  return job;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "other";
  }
}

export function gapFor(url: string): number {
  const host = hostOf(url);
  if (host.includes("mesonet.agron.iastate.edu")) return 400;
  if (host.includes("mtarchive.geol.iastate.edu")) return 350;
  if (host.includes("spc.noaa.gov") || host.includes("noaa.gov")) return 120;
  return 200;
}
