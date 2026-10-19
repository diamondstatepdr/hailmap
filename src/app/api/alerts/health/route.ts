import { alertHealth } from "@/lib/alert-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(alertHealth());
}
