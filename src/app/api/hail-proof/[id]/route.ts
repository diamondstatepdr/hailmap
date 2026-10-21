import { proofFilename, renderHailProofPdf } from "@/lib/hail-proof";
import { readHailProof } from "@/lib/hail-proof-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const proof = readHailProof(id);
  if (!proof) return Response.json({ error: "That hail proof was not found." }, { status: 404 });
  const pdf = renderHailProofPdf(proof);
  const filename = proofFilename(proof.address);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
