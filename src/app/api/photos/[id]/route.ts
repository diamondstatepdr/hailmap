import fs from "node:fs";
import { resolvePhoto } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const photo = resolvePhoto(id);
  if (!photo) return new Response("Photo not found", { status: 404 });
  const bytes = fs.readFileSync(photo.absolute);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
