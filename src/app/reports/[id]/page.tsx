import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/brand/Logo";
import PrintButton from "@/components/PrintButton";
import ScoreRing from "@/components/ui/ScoreRing";
import Sparkline from "@/components/ui/Sparkline";
import { getStormReport } from "@/lib/accounts";
import { formatWhen } from "@/lib/filters";
import type { StormReportDocument } from "@/lib/storm-report";

export const dynamic = "force-dynamic";

function isDocument(value: unknown): value is StormReportDocument {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StormReportDocument>;
  return Boolean(row.title && row.score && row.place && Array.isArray(row.timeline));
}

export default async function StormReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stored = getStormReport(id);
  if (!stored || !isDocument(stored.payload)) notFound();
  const report = stored.payload;
  const photos = report.photos.filter((photo) => /^\/api\/photos\/[0-9a-f-]+$/i.test(photo.url));
  const windowLabel =
    report.rangeLabel ??
    (report.hours === 0.75 ? "45 minutes" : report.hours < 24 ? `${report.hours} hours` : `${report.hours / 24} days`);
  const candidates = report.lossCandidates ?? [];
  const meshDays = report.meshDays ?? [];
  const nearby = report.nearbyWarnings ?? [];
  const mapSvg = report.snapshotSvg || report.svg;

  return (
    <main className="report-paper min-h-screen px-3 py-6 sm:px-6 print:px-0 print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold text-accent">
          Back to HailMap
        </Link>
        <PrintButton />
      </div>
      <article className="report-sheet">
        <header className="report-banner">
          <div className="flex items-center gap-3">
            <LogoMark size={42} title="HailMap" />
            <div>
              <p className="text-lg font-semibold leading-none tracking-tight">HailMap</p>
              <p className="report-kicker mt-1">Storm intelligence</p>
            </div>
          </div>
          <p className="text-right text-xs font-semibold uppercase tracking-[0.16em]">Storm report</p>
        </header>
        <div className="px-5 py-6 sm:px-8">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{report.title}</h1>
          <p className="mt-2 text-sm text-muted">
            Generated {formatWhen(report.createdAt)} · {report.kind === "area" ? "Selected area" : "Address"} ·{" "}
            {report.rangeLabel ? windowLabel : `last ${windowLabel}`}
          </p>
          {report.scoreDate ? (
            <p className="mt-1 text-sm font-semibold text-ink">Damage score is for {report.scoreDate}, the selected storm. Older dates stay in the history below.</p>
          ) : null}
          <p className="mt-1 text-sm text-muted">
            {report.place.lat.toFixed(4)}, {report.place.lon.toFixed(4)}
            {report.place.radiusKm ? ` · ${report.place.radiusKm} km radius` : " · reports inside the box"}
          </p>

          <section className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
            <ScoreRing score={report.score.score} level={report.score.level} />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: scoreColor(report.score.level) }}>
                Damage probability · {report.score.level}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{report.score.summary}</p>
            </div>
          </section>

          <dl className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat label="Radar max hail" value={report.meshMaxIn != null ? `${report.meshMaxIn.toFixed(2)} in` : "—"} />
            <Stat label="Spotter max hail" value={report.stats.maxHailIn != null ? `${report.stats.maxHailIn.toFixed(2)} in` : "—"} />
            <Stat label="Max wind" value={report.stats.maxWindMph != null ? `${report.stats.maxWindMph} mph` : "—"} />
            <Stat label="Tornado" value={report.stats.strongestTornado ?? "—"} />
            <Stat label="Reports" value={String(report.stats.reportCount)} />
            <Stat label="Nearest" value={report.stats.nearestKm != null ? `${report.stats.nearestKm.toFixed(1)} km` : "—"} />
          </dl>

          <h2 className="mt-8 text-lg font-semibold tracking-tight">Map</h2>
          <p className="mt-1 text-sm text-muted">Address marker, radar hail swaths, and nearby reports.</p>
          <div className="report-map mt-3 overflow-hidden rounded-2xl border border-line" dangerouslySetInnerHTML={{ __html: mapSvg }} />
          {report.snapshotSvg ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted">© OpenStreetMap contributors · NOAA MRMS MESH</p>
          ) : null}

          {candidates.length ? (
            <>
              <h2 className="mt-8 text-lg font-semibold tracking-tight">Date of loss candidates</h2>
              <p className="mt-1 text-sm text-muted">
                Days with at least 1.00 in of hail (spotter or radar), a 58 mph wind report, or a tornado inside the radius. The largest hail days are listed first.
              </p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                      <th className="py-2 pr-3 font-semibold">Storm date</th>
                      <th className="py-2 pr-3 font-semibold">Radar</th>
                      <th className="py-2 pr-3 font-semibold">Spotter</th>
                      <th className="py-2 pr-3 font-semibold">Wind</th>
                      <th className="py-2 font-semibold">Tornado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((day) => (
                      <tr key={day.date} className="border-b border-line">
                        <td className="py-2 pr-3 font-semibold">{day.label}</td>
                        <td className="py-2 pr-3">{day.meshMaxIn != null ? `${day.meshMaxIn.toFixed(2)} in` : "—"}</td>
                        <td className="py-2 pr-3">{day.spotterMaxIn != null ? `${day.spotterMaxIn.toFixed(2)} in` : "—"}</td>
                        <td className="py-2 pr-3">{day.windMaxMph != null ? `${day.windMaxMph} mph` : "—"}</td>
                        <td className="py-2">{day.tornado ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          <h2 className="mt-8 text-lg font-semibold tracking-tight">Radar hail by date</h2>
          <p className="mt-1 text-sm text-muted">
            NOAA MRMS MESH at this address. Sizes are estimates for the radar grid cell, not a ground survey.
          </p>
          {meshDays.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-semibold">Storm date</th>
                    <th className="py-2 pr-3 font-semibold">Radar max</th>
                    <th className="py-2 font-semibold">Product</th>
                  </tr>
                </thead>
                <tbody>
                  {meshDays.map((day) => (
                    <tr key={`${day.label}-${day.date ?? "window"}`} className="border-b border-line">
                      <td className="py-2 pr-3">{day.label}</td>
                      <td className="py-2 pr-3 font-semibold">{day.maxIn != null ? `${day.maxIn.toFixed(2)} in` : "None at this point"}</td>
                      <td className="py-2 text-muted">{day.product.replaceAll("_", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">{report.meshNote ?? "Radar hail was not included."}</p>
          )}
          {meshDays.length && report.meshNote ? <p className="mt-2 text-xs leading-relaxed text-muted">{report.meshNote}</p> : null}

          <h2 className="mt-8 text-lg font-semibold tracking-tight">NWS warnings nearby</h2>
          {report.nearbyWarningNote ? <p className="mt-2 text-sm text-muted">{report.nearbyWarningNote}</p> : null}
          {nearby.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {nearby.map((warning) => (
                <li key={warning.id} className="rounded-xl border border-line px-3 py-2">
                  <span className="font-semibold">{warning.event}</span>
                  <span className="mt-0.5 block text-muted">
                    {warning.kind}
                    {warning.office ? ` · ${warning.office}` : ""}
                    {warning.area ? ` · ${warning.area}` : ""}
                  </span>
                  {warning.issued ? <span className="block text-xs text-muted">Issued {formatWhen(warning.issued)}</span> : null}
                  {warning.until ? <span className="block text-xs text-muted">Until {formatWhen(warning.until)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          {report.timeline.length ? (
            <div className="mt-6">
              <Sparkline
                times={report.timeline.map((row) => row.when)}
                hours={report.hours}
                endAt={report.createdAt}
                caption="Reports in this document"
              />
            </div>
          ) : null}

          <h2 className="mt-8 text-lg font-semibold tracking-tight">Why this score</h2>
          <ul className="mt-2 space-y-2">
            {report.score.factors.map((factor) => (
              <li key={factor.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                <span className="font-semibold">
                  {factor.label}
                  {factor.points ? ` · ${factor.points} pts` : ""}
                </span>
                <span className="mt-1 block text-muted">{factor.detail}</span>
                <span className="factor-track mt-2 block">
                  <span className="factor-fill block" style={{ width: `${Math.max(factor.points ? 6 : 0, Math.min(100, factor.points))}%` }} />
                </span>
              </li>
            ))}
          </ul>

          <h2 className="mt-8 text-lg font-semibold tracking-tight">Active alerts</h2>
          {report.warningNote ? <p className="mt-2 text-sm text-muted">{report.warningNote}</p> : null}
          {report.warnings.length ? (
            <ul className="mt-2 space-y-2 text-sm">
              {report.warnings.map((warning) => (
                <li key={`${warning.kind}-${warning.event}`} className="rounded-xl border border-line px-3 py-2">
                  <span className="font-semibold">{warning.event}</span>
                  {warning.until ? <span className="block text-muted">Until {formatWhen(warning.until)}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <h2 className="mt-8 text-lg font-semibold tracking-tight">Nearby reports</h2>
          {report.timeline.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-semibold">When</th>
                    <th className="py-2 pr-3 font-semibold">Hazard</th>
                    <th className="py-2 pr-3 font-semibold">Size</th>
                    <th className="py-2 pr-3 font-semibold">Where</th>
                    <th className="py-2 font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {report.timeline.map((row) => (
                    <tr key={row.id} className="border-b border-line align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(row.when)}</td>
                      <td className="py-2 pr-3">{row.hazard}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{row.magnitude}</td>
                      <td className="py-2 pr-3">
                        {row.where}
                        {row.distanceKm != null ? <span className="block text-xs text-muted">{row.distanceKm.toFixed(1)} km</span> : null}
                        {row.remark ? <span className="block text-xs text-muted">{row.remark}</span> : null}
                      </td>
                      <td className="py-2">
                        {row.source}
                        <span className="block text-xs text-muted">{row.confidence}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No hail, wind, or tornado reports in this window.</p>
          )}

          <h2 className="mt-8 text-lg font-semibold tracking-tight">Field photos</h2>
          <p className="mt-1 text-sm text-muted">Photos attached in Field mode. These are the signed-in user’s notes, not official reports.</p>
          {photos.length ? (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {photos.map((photo) => (
                <li key={photo.url + photo.takenAt} className="overflow-hidden rounded-2xl border border-line">
                  <img src={photo.url} alt={`${photo.damageType} damage photo`} className="h-48 w-full object-cover" />
                  <div className="px-3 py-2 text-sm">
                    <p className="font-semibold capitalize">
                      {photo.damageType} · {photo.pinStatus}
                    </p>
                    <p className="text-xs text-muted">{formatWhen(photo.takenAt)}</p>
                    {photo.note ? <p className="mt-1">{photo.note}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No field photos were attached for this account.</p>
          )}

          <h2 className="mt-8 text-lg font-semibold tracking-tight">Sources</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
            {report.sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
          <p className="mt-6 border-t border-line pt-4 text-sm leading-relaxed text-muted">{report.disclaimer}</p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">HailMap · Storm intelligence</p>
        </div>
      </article>
    </main>
  );
}

function scoreColor(level: string): string {
  if (level === "Very High") return "#e11d48";
  if (level === "High") return "#ea580c";
  if (level === "Moderate") return "#d97706";
  return "#0f9f6e";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
