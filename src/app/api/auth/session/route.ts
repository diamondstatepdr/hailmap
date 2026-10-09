import { clearSessionCookie, normalizeUserName, readSession, sessionCookie, signSession, verifyPasscode, authConfigured } from "@/lib/auth";
import { upsertUser } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = readSession(request);
  return Response.json({ user, configured: authConfigured() });
}

export async function POST(request: Request) {
  if (!authConfigured()) {
    return Response.json(
      { error: "Sign-in is not configured. Set HAILMAP_TEAM_PASSCODE on the server." },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const user = normalizeUserName(String(record.name ?? ""));
  if (!user) return Response.json({ error: "Enter a name between 2 and 60 characters." }, { status: 400 });
  if (!verifyPasscode(String(record.passcode ?? ""))) {
    return Response.json({ error: "That passcode is not right." }, { status: 401 });
  }
  upsertUser(user);
  return Response.json(
    { user },
    { status: 200, headers: { "set-cookie": sessionCookie(signSession(user)), "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  return Response.json({ user: null }, { headers: { "set-cookie": clearSessionCookie() } });
}
