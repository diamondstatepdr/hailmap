import { requireUser } from "@/lib/auth";
import { readProofIdentity, saveProofIdentity } from "@/lib/hail-proof-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requireUser(request);
  if ("response" in auth) return auth.response;
  return Response.json(readProofIdentity());
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
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const company = typeof row.company === "string" ? row.company : "";
  const phone = typeof row.phone === "string" ? row.phone : "";
  return Response.json(saveProofIdentity(company, phone));
}
