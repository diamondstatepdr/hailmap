import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/brand/Logo";
import ProofActions from "@/components/hail-proof/ProofActions";
import { proofFilename, proofMapSvg, proofSwathStat } from "@/lib/hail-proof";
import { readHailProof } from "@/lib/hail-proof-store";
import { proofStreetSvg } from "@/lib/proof-map";

export const dynamic = "force-dynamic";

export default async function HailProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proof = readHailProof(id);
  if (!proof) notFound();
  const filename = proofFilename(proof.address);
  const dates = proof.storms.map((storm) => storm.label || storm.date);
  const map = await proofStreetSvg(proof, proofMapSvg(proof));
  const companyLine = [proof.company, proof.phone].filter(Boolean).join(" · ");
  const swathLine = proof.swathLine || proofSwathStat(proof.rings);
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
          {companyLine ? <p className="proof-company">{companyLine}</p> : null}
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
              <dd>{dates.length ? dates.join(", ") : "—"}</dd>
            </div>
          </dl>
          {proof.confirm ? (
            <section className="proof-confirm" data-proof-confirm>
              <div className="proof-confirm-copy">
                {proof.confirm.seal ? null : (
                  <p className="proof-radar-only" data-proof-radar-only>
                    Radar only
                  </p>
                )}
                <p className="proof-radar-line">
                  {proof.confirm.radarLocal && proof.confirm.radarUtc ? (
                    <>
                      {proof.confirm.radarKind === "daily" ? "24-hour radar maximum ending" : "Radar scan"}
                      {proof.confirm.radarKind === "scan" && proof.confirm.radarIn != null
                        ? ` ${proof.confirm.radarIn.toFixed(2)} in`
                        : ""}{" "}
                      <span className="proof-local">{proof.confirm.radarLocal}</span>{" "}
                      <span className="proof-utc">({proof.confirm.radarUtc})</span>
                    </>
                  ) : (
                    proof.confirm.radarLine
                  )}
                </p>
                {proof.confirm.reports.length ? (
                  <ul className="proof-spotters">
                    {proof.confirm.reports.map((report) => (
                      <li key={`${report.timeUtc}-${report.where}-${report.sizeIn}`}>
                        <span className="spot-size">
                          {report.sizeIn.toFixed(2)} in · {report.distanceMi.toFixed(1)} mi · {report.where}
                        </span>
                        <span className="spot-when">
                          {report.timeLocal} <span className="proof-utc">({report.timeUtc})</span>
                        </span>
                        <span className="spot-meta">{report.source}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {proof.confirm.note ? <p className="proof-confirm-note">{proof.confirm.note}</p> : null}
                <p className="proof-confirm-note">{proof.confirm.disclaimer}</p>
              </div>
              {proof.confirm.seal ? (
                <div className="proof-seal" data-proof-seal>
                  <svg className="proof-seal-check" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M5 12.5 10 17.5 19.5 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="proof-seal-title">
                    Radar +
                    <br />
                    spotter
                    <br />
                    confirmed
                  </span>
                  {dates[0] ? <span className="proof-seal-date">{dates[0]}</span> : null}
                </div>
              ) : null}
            </section>
          ) : null}
          <div className="proof-map" dangerouslySetInnerHTML={{ __html: map }} />
          <p className="text-[11px] text-muted">Streets © OpenStreetMap contributors</p>
          {swathLine ? <p className="text-sm font-semibold">{swathLine}</p> : null}
          {proof.nearby.length ? (
            <>
              <h3>Nearby reports</h3>
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
            </>
          ) : null}
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
