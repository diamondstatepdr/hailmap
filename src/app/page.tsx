import { cookies } from "next/headers";
import HailApp from "@/components/HailApp";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { INTRO_COOKIE, shouldShowWelcome } from "@/lib/plain";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [jar, params] = await Promise.all([cookies(), searchParams]);
  const signedIn = Boolean(verifySessionToken(jar.get(SESSION_COOKIE)?.value));
  const seen = jar.get(INTRO_COOKIE)?.value === "1";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
    else if (value?.[0]) query.set(key, value[0]);
  }
  const intro = shouldShowWelcome(seen ? "1" : null, query.size ? `?${query}` : "", signedIn);
  return <HailApp intro={intro} />;
}
