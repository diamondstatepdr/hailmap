import { requireUser } from "@/lib/auth";
import { testCrm } from "@/lib/crm";
import { salesDenied } from "@/lib/sales-gate";
import { accountScope } from "@/lib/team-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const denied = salesDenied(auth.user);
  if (denied) return denied;
  try {
    const result = await testCrm(accountScope(auth.user));
    if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ message: result.message });
  } catch (error) {
    console.error("[hailmap] crm test", error instanceof Error ? error.message : "failed");
    return Response.json({ error: "Could not reach that service." }, { status: 502 });
  }
}
