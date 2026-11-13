import { requireUser } from "@/lib/auth";
import { leadCsv } from "@/lib/leads";
import { listLeads } from "@/lib/leads-store";
import { salesDenied } from "@/lib/sales-gate";
import { memberTeamKey } from "@/lib/team-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const denied = salesDenied(auth.user);
  if (denied) return denied;
  const format = new URL(request.url).searchParams.get("format");
  const leads = listLeads(memberTeamKey(auth.user));
  if (format === "csv" || format === "sheets") {
    const sheets = format === "sheets";
    const body = leadCsv(leads, sheets);
    return new Response(body, {
      headers: {
        "Content-Type": sheets ? "text/csv; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="swathline-leads${sheets ? "-sheets" : ""}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return Response.json({ leads });
}
