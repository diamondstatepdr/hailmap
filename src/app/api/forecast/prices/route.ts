import { readSession, requireUser } from "@/lib/auth";
import { normalizePrices } from "@/lib/forecast";
import { readPrices, writePrices } from "@/lib/forecast-store";
import { salesDenied } from "@/lib/sales-gate";
import { memberTeamKey } from "@/lib/team-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = readSession(request);
  return Response.json({ prices: readPrices(user ? memberTeamKey(user) : undefined), estimate: true });
}

export async function POST(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const denied = salesDenied(auth.user);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const prices = normalizePrices(body);
  if ("error" in prices) return Response.json({ error: prices.error }, { status: 400 });
  return Response.json({ prices: writePrices(prices, memberTeamKey(auth.user)), estimate: true });
}
