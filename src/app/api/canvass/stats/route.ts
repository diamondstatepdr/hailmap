import { canvassCounts } from "@/lib/canvass-store";
import { requireUser } from "@/lib/auth";
import { salesDenied } from "@/lib/sales-gate";
import { memberTeamKey } from "@/lib/team-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const denied = salesDenied(auth.user);
  if (denied) return denied;
  const url = new URL(request.url);
  const day = url.searchParams.get("day") ?? "";
  const timeZone = url.searchParams.get("tz") ?? "UTC";
  const counts = canvassCounts(day, timeZone, memberTeamKey(auth.user));
  if (!counts) return Response.json({ error: "Use a day like 2026-04-25 and a valid time zone." }, { status: 400 });
  const totals = counts.reduce(
    (sum, row) => ({
      knocked: sum.knocked + row.knocked,
      notHome: sum.notHome + row.notHome,
      interested: sum.interested + row.interested,
      signed: sum.signed + row.signed,
      total: sum.total + row.total,
    }),
    { knocked: 0, notHome: 0, interested: 0, signed: 0, total: 0 },
  );
  return Response.json({ day, timeZone, counts, totals });
}
