import { reportCount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return Response.json({ ok: true, reports: reportCount() });
  } catch (error) {
    console.error("[hailmap] health", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
