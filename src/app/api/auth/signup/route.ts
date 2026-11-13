import { createHash } from "node:crypto";
import { takeActionSlot } from "@/lib/accounts";
import { authConfigured, sessionCookie, signSession } from "@/lib/auth";
import { billingEnabled, billingSnapshot } from "@/lib/billing";
import { passwordProblem } from "@/lib/passwords";
import { clientIp } from "@/lib/photos";
import { createAccount, getAccountByEmail, normalizeEmail } from "@/lib/user-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.HAILMAP_AUTH_SECRET?.trim() && !process.env.HAILMAP_TEAM_PASSCODE?.trim()) {
    return Response.json(
      { error: "Sign-in is not configured. Set HAILMAP_AUTH_SECRET on the server." },
      { status: 503 },
    );
  }
  const hash = createHash("sha256").update(`signup|${clientIp(request)}`).digest("hex");
  const slot = takeActionSlot(hash, "signup", 8, 3600000);
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const email = normalizeEmail(String(record.email ?? ""));
  if (!email) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const password = String(record.password ?? "");
  const problem = passwordProblem(password);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  if (getAccountByEmail(email)) return Response.json({ error: "An account with that email already exists." }, { status: 409 });
  const account = await createAccount({ name: String(record.name ?? ""), email, password });
  if (!account) {
    if (getAccountByEmail(email)) return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    return Response.json({ error: "Enter a name between 2 and 60 characters." }, { status: 400 });
  }
  const user = { id: account.id, name: account.name, role: "member" as const, email: account.email };
  return Response.json(
    {
      user,
      configured: authConfigured(),
      billing: billingSnapshot(user, account),
      billingEnabled: billingEnabled(),
    },
    { status: 201, headers: { "set-cookie": sessionCookie(signSession(user)), "Cache-Control": "no-store" } },
  );
}
