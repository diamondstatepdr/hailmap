import { assertWebhookAuth, saveManualReport } from "@/lib/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = assertWebhookAuth(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const saved = saveManualReport(body, "spotter", "spotter");
    if (!saved.ok) return Response.json({ error: saved.error }, { status: 400 });
    return Response.json({ ok: true, externalId: saved.externalId }, { status: 201 });
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
}
