import { requireUser } from "@/lib/auth";
import { sendLeads } from "@/lib/crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  try {
    const result = await sendLeads(auth.user.id);
    if (!result.ok) {
      const status = result.error.startsWith("Save a webhook") ? 409 : 502;
      return Response.json({ error: result.error, sent: result.sent ?? 0 }, { status });
    }
    return Response.json({ sent: result.sent, skipped: result.skipped, message: result.message });
  } catch (error) {
    console.error("[hailmap] crm leads", error instanceof Error ? error.message : "failed");
    return Response.json({ error: "Could not send leads." }, { status: 502 });
  }
}
