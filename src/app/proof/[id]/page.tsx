import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/brand/Logo";
import ProofActions from "@/components/hail-proof/ProofActions";
import { proofFilename, proofMapSvg, proofSwathStat } from "@/lib/hail-proof";
import { readHailProof } from "@/lib/hail-proof-store";

export const dynamic = "force-dynamic";

export default async function HailProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proof = readHailProof(id);
  if (!proof) notFound();
  const filename = proofFilename(proof.address);
  const dates = proof.storms.map((storm) => storm.label || storm.date);
  return (
    <main className="proof-page">
      <div className="proof-toolbar">
        <Link href="/" className="text-sm font-semibold">
          Back to Swathline
        </Link>
      </div>
      <article className="proof-sheet" data-hail-proof-page>
        <header className="proof-banner">
          <LogoMark size={36} />
          <div>
            <p className="proof-kicker">Swathline</p>
            <h1>Hail proof</h1>
          </div>
          <span className="proof-estimate">Estimate</span>
        </header>
        <div className="proof-body">
          <h2>{proof.address}</h2>
          <p className="text-xs text-muted">
            {proof.lat.toFixed(5)}, {proof.lon.toFixed(5)}
          </p>
          <dl className="proof-stats">
            <div>
              <dt>Max hail</dt>
              <dd>{proof.maxHailIn != null ? `${proof.maxHailIn.toFixed(2)} in` : "—"}</dd>
            </div>
            <div>
              <dt>Damage score</dt>
              <dd>
                {proof.level} · {proof.score}/100
              </dd>
            </div>
            <div>
              <dt>Storm dates</dt>
              <dd>{dates.length ? dates.join(", ") : "None in this view"}</dd>
            </div>
          </dl>
          <div className="proof-map" dangerouslySetInnerHTML={{ __html: proofMapSvg(proof) }} />
          {proofSwathStat(proof.rings) ? <p className="text-sm font-semibold">{proofSwathStat(proof.rings)}</p> : null}
          <h3>Nearby reports</h3>
          {proof.nearby.length ? (
            <ul className="proof-list">
              {proof.nearby.map((report) => (
                <li key={`${report.when}-${report.where}-${report.detail}`}>
                  <span className="font-semibold">{report.detail}</span>
                  <span className="text-muted">
                    {report.when} · {report.where}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No nearby reports in this view.</p>
          )}
          <h3>Damage score</h3>
          <p className="text-sm leading-relaxed">{proof.summary}</p>
          <p className="proof-disclaimer">
            This is an estimate from Swathline storm evidence. It is not a roof inspection, an insurance decision, or a
            guarantee that hail damaged this address.
          </p>
          <ProofActions id={proof.id} filename={filename} address={proof.address} />
        </div>
      </article>
    </main>
  );
}
