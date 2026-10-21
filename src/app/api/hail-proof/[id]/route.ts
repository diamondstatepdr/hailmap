import { proofFilename } from "@/lib/hail-proof";
import { renderHailProofPdf } from "@/lib/hail-proof-pdf";
import { readHailProof } from "@/lib/hail-proof-store";
import { proofStreetRaster } from "@/lib/proof-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const proof = readHailProof(id);
  if (!proof) return Response.json({ error: "That hail proof was not found." }, { status: 404 });
  const image = await proofStreetRaster(proof);
  const pdf = renderHailProofPdf(proof, image);
  const filename = proofFilename(proof.address);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
