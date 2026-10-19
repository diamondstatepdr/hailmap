import { getVapid } from "@/lib/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const keys = getVapid();
  return Response.json({ publicKey: keys.publicKey });
}
