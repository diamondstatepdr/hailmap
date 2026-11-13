import { requireUser } from "@/lib/auth";
import { asCrmProvider, countLeadPins, publicCrm, saveCrm } from "@/lib/crm";
import { salesDenied } from "@/lib/sales-gate";
import { accountScope } from "@/lib/team-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  const denied = salesDenied(auth.user);
  if (denied) return denied;
  return Response.json({ ...publicCrm(accountScope(auth.user)), leadCount: countLeadPins(auth.user.id) });
}

export async function PUT(request: Request) {
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
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const provider = asCrmProvider(record.provider);
  if (!provider) return Response.json({ error: "Choose a webhook, JobNimbus, or AccuLynx." }, { status: 400 });
  const saved = await saveCrm({
    provider,
    secret: typeof record.secret === "string" ? record.secret : null,
    recordType: typeof record.recordType === "string" ? record.recordType : null,
    statusName: typeof record.statusName === "string" ? record.statusName : null,
    scope: accountScope(auth.user),
  });
  if (!saved.ok) return Response.json({ error: saved.error }, { status: 400 });
  return Response.json(saved.settings);
}
