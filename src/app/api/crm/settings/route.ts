import { requireUser } from "@/lib/auth";
import { asCrmProvider, countLeadPins, publicCrm, saveCrm } from "@/lib/crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  return Response.json({ ...publicCrm(), leadCount: countLeadPins(auth.user.id) });
}

export async function PUT(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const provider = asCrmProvider(record.provider);
  if (!provider) return Response.json({ error: "Choose a webhook, JobNimbus, or AccuLynx." }, { status: 400 });
  const saved = await saveCrm({
    provider,
    secret: typeof record.secret === "string" ? record.secret : null,
    recordType: typeof record.recordType === "string" ? record.recordType : null,
    statusName: typeof record.statusName === "string" ? record.statusName : null,
  });
  if (!saved.ok) return Response.json({ error: saved.error }, { status: 400 });
  return Response.json(saved.settings);
}
