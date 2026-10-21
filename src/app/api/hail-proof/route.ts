import { createHash } from "node:crypto";
import { takeActionSlot } from "@/lib/accounts";
import { normalizeProof, proofFilename } from "@/lib/hail-proof";
import { saveHailProof } from "@/lib/hail-proof-store";
import { clientIp } from "@/lib/photos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const hash = createHash("sha256").update(`hail-proof|${clientIp(request)}`).digest("hex");
  const slot = takeActionSlot(hash, "hail-proof", 30, 3600000);
  if (!slot.ok) return Response.json({ error: slot.error }, { status: 429 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const proof = normalizeProof(body);
  if ("error" in proof) return Response.json({ error: proof.error }, { status: 400 });
  const saved = saveHailProof(proof);
  return Response.json(
    {
      id: saved.id,
      url: `/proof/${saved.id}`,
      pdfUrl: `/api/hail-proof/${saved.id}`,
      filename: proofFilename(saved.address),
    },
    { status: 201 },
  );
}
