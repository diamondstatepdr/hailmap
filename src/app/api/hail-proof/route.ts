import { createHash } from "node:crypto";
import { takeActionSlot } from "@/lib/accounts";
import { normalizeProof, proofFilename, type HailProof } from "@/lib/hail-proof";
import { saveHailProof } from "@/lib/hail-proof-store";
import { formatStormDate } from "@/lib/mesh-plan";
import { clientIp } from "@/lib/photos";
import { unavailableConfirm } from "@/lib/proof-confirm";
import { loadProofConfirm } from "@/lib/proof-confirm-load";

function rememberStormDate(proof: HailProof, stormDate: string, hailIn: number | null): HailProof {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stormDate) || proof.storms.some((storm) => storm.date === stormDate)) return proof;
  return {
    ...proof,
    storms: [{ date: stormDate, label: formatStormDate(stormDate), hailIn }, ...proof.storms].slice(0, 8),
  };
}

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
  const requested = body && typeof body === "object" ? (body as { stormDate?: unknown }).stormDate : null;
  const stormDate = typeof requested === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : "";
  let confirm = null;
  if (stormDate) {
    try {
      confirm = await loadProofConfirm({ lat: proof.lat, lon: proof.lon, stormDate });
    } catch {
      confirm = unavailableConfirm();
    }
  }
  const saved = saveHailProof(rememberStormDate({ ...proof, confirm }, stormDate, confirm?.radarIn ?? proof.maxHailIn));
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
