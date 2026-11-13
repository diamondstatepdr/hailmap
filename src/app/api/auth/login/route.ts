import { createHash } from "node:crypto";
import { takeActionSlot } from "@/lib/accounts";
import { sessionCookie, signSession } from "@/lib/auth";
import { billingSnapshot } from "@/lib/billing";
import { verifyPassword } from "@/lib/passwords";
import { clientIp } from "@/lib/photos";
import { getAccountByEmail, normalizeEmail } from "@/lib/user-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!process.env.HAILMAP_AUTH_SECRET?.trim() && !process.env.HAILMAP_TEAM_PASSCODE?.trim()) {
    return Response.json(
      { error: "Sign-in is not configured. Set HAILMAP_AUTH_SECRET on the server." },
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
  const email = normalizeEmail(String(record.email ?? ""));
  const password = String(record.password ?? "");
  if (!email || !password) return Response.json({ error: "Enter your email and password." }, { status: 400 });
  const hash = createHash("sha256").update(`login|${clientIp(request)}|${email}`).digest("hex");
  const slot = takeActionSlot(hash, "login", 12, 15 * 60 * 1000);
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 429 });
  const account = getAccountByEmail(email);
  const match = account ? await verifyPassword(password, account.passwordHash) : false;
  if (!account || !match) return Response.json({ error: "That email or password is not right." }, { status: 401 });
  const user = { id: account.id, name: account.name, role: "member" as const, email: account.email };
  return Response.json(
    { user, billing: billingSnapshot(user, account) },
    { headers: { "set-cookie": sessionCookie(signSession(user)), "Cache-Control": "no-store" } },
  );
}
