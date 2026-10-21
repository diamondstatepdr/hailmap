import { proofSwathStat, streetFrame, type HailProof } from "@/lib/hail-proof";
import { buildPdf, pdfText, wrapPdfText, type PdfImage } from "@/lib/pdf-doc";

function project(bounds: { west: number; south: number; east: number; north: number }, frame: { x: number; y: number; w: number; h: number }, lon: number, lat: number) {
  const x = frame.x + ((lon - bounds.west) / (bounds.east - bounds.west)) * frame.w;
  const y = frame.y + ((lat - bounds.south) / (bounds.north - bounds.south)) * frame.h;
  return { x, y };
}

function pdfRgb(hex: string): string {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#f97316";
  const n = Number.parseInt(value.slice(1), 16);
  return `${(((n >> 16) & 255) / 255).toFixed(3)} ${(((n >> 8) & 255) / 255).toFixed(3)} ${((n & 255) / 255).toFixed(3)}`;
}

function text(font: "F1" | "F2", size: number, x: number, y: number, value: string, color = "0.07 0.12 0.22") {
  return `BT /${font} ${size} Tf ${color} rg ${x.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(value)}) Tj ET\n`;
}

function companyContact(proof: HailProof): string[] {
  const line = [proof.company, proof.phone].filter(Boolean).join(" · ").slice(0, 80);
  return line ? [text("F1", 10, 36, 670, line, "0.28 0.35 0.46")] : [];
}

function textWidth(value: string, size: number): number {
  return value.length * size * 0.56;
}

function centerText(size: number, cx: number, y: number, value: string, color: string): string {
  return text("F2", size, cx - textWidth(value, size) / 2, y, value, color);
}

/** Filled medallion. The date is the convective day, never the UTC calendar date. */
function sealBadge(date: string): string {
  const cx = 508;
  const cy = 378;
  const r = 58;
  const ink = "1 1 1";
  return [
    "0.114 0.306 0.847 RG 3.2 w",
    `${cx} ${cy} ${r + 5} 0 360 arc S`,
    "0.114 0.306 0.847 rg",
    `${cx} ${cy} ${r} 0 360 arc f`,
    "1 1 1 RG 1.3 w",
    `${cx} ${cy} ${r - 6} 0 360 arc S`,
    "1 1 1 RG 2.6 w 1 J 1 j",
    `${cx - 14} ${cy + 28} m ${cx - 6} ${cy + 20} l ${cx + 16} ${cy + 42} l S`,
    centerText(9, cx, cy + 8, "RADAR +", ink),
    centerText(9, cx, cy - 4, "SPOTTER", ink),
    centerText(9, cx, cy - 16, "CONFIRMED", ink),
    date ? centerText(8, cx, cy - 32, date, ink) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function confirmBlock(proof: HailProof): string {
  const confirm = proof.confirm;
  if (!confirm) return "";
  const lines: string[] = [];
  const width = confirm.seal ? 72 : 105;
  if (confirm.seal) {
    const date = proof.storms[0]?.label || "";
    lines.push(sealBadge(date));
  } else {
    lines.push(text("F2", 11, 36, 438, "Radar only", "0.28 0.35 0.46"));
  }
  let y = confirm.seal ? 424 : 422;
  lines.push(text("F1", 8, 36, y, confirm.radarLine.slice(0, width), "0.20 0.26 0.36"));
  y -= 16;
  for (const report of confirm.reports.slice(0, 3)) {
    const when = `${report.timeLocal} (${report.timeUtc})`;
    lines.push(text("F1", 8, 36, y, `${report.sizeIn.toFixed(2)} in · ${report.distanceMi.toFixed(1)} mi · ${when}`.slice(0, width)));
    y -= 11;
    lines.push(text("F1", 8, 36, y, `${report.where} · ${report.source}`.slice(0, width), "0.20 0.26 0.36"));
    y -= 12;
  }
  const wrap = confirm.seal ? 68 : 108;
  if (confirm.note) {
    for (const line of wrapPdfText(confirm.note, wrap).slice(0, 2)) {
      y -= 11;
      lines.push(text("F1", 8, 36, y, line, "0.28 0.35 0.46"));
    }
  }
  for (const line of wrapPdfText(confirm.disclaimer, wrap).slice(0, 2)) {
    y -= 11;
    lines.push(text("F1", 8, 36, y, line, "0.28 0.35 0.46"));
  }
  return lines.join("");
}

export function renderHailProofPdf(proof: HailProof, image?: PdfImage | null): Buffer {
  const hailLine = proof.maxHailIn != null ? `${proof.maxHailIn.toFixed(2)} in` : "No hail size";
  const dates = proof.storms.map((storm) => storm.label || storm.date).join(", ") || "—";
  const bounds = streetFrame(proof.lat, proof.lon);
  const mapY = proof.confirm ? 460 : 392;
  const mapH = proof.confirm ? 132 : 200;
  const frame = { x: 36, y: mapY, w: 540, h: mapH };
  const clip = `q 36 ${mapY} 540 ${mapH} re W n\n`;
  let map = image
    ? `${clip}q 540 0 0 ${mapH} 36 ${mapY} cm /Im0 Do Q\n`
    : `q 0.91 0.93 0.96 rg 36 ${mapY} 540 ${mapH} re f Q\n`;
  map += `${clip}/GS1 gs\n`;
  proof.rings.forEach((ring, band) => {
    map += `${pdfRgb(proof.colors[band] || "#f97316")} rg 0.06 0.13 0.20 RG\n`;
    ring.forEach(([lon, lat], index) => {
      const point = project(bounds, frame, lon, lat);
      map += `${point.x.toFixed(1)} ${point.y.toFixed(1)} ${index === 0 ? "m" : "l"} `;
    });
    map += "h f S\n";
  });
  map += "Q\n";
  const pin = project(bounds, frame, proof.lon, proof.lat);
  map += `0.04 0.12 0.43 rg ${pin.x.toFixed(1)} ${pin.y.toFixed(1)} 5 0 360 arc f\n`;
  const measured = proof.swathLine || proofSwathStat(proof.rings);
  map += text("F1", 9, 48, mapY + mapH - 20, measured ? `Swath · ${measured}` : "Street map", "0.24 0.30 0.40");

  const summary = wrapPdfText(proof.summary, 92).slice(0, proof.confirm ? 2 : 3);
  const nearbyTop = proof.confirm ? 286 : 348;
  const nearbyCount = proof.confirm ? 3 : 6;
  let nearby = "";
  if (proof.nearby.length) {
    nearby += text("F2", 11, 36, proof.confirm ? 302 : 368, "Nearby reports");
    proof.nearby.slice(0, nearbyCount).forEach((report, index) => {
      const y = nearbyTop - index * 14;
      nearby += text("F1", 9, 40, y, `${report.when}   ${report.detail}   ${report.where}`.slice(0, 96));
    });
  }

  const contact = companyContact(proof);
  const content = [
    "0.04 0.12 0.43 rg 0 720 612 72 re f\n",
    text("F2", 18, 36, 756, "SWATHLINE", "1 1 1"),
    text("F1", 11, 36, 736, "Hail proof", "0.85 0.91 1"),
    text("F1", 9, 430, 748, "Estimate", "1 1 1"),
    text("F2", 16, 36, 688, proof.address.slice(0, 70)),
    ...contact,
    text("F1", 10, 36, contact.length ? 654 : 670, `${proof.lat.toFixed(5)}, ${proof.lon.toFixed(5)}`, "0.28 0.35 0.46"),
    "0.96 0.97 0.99 rg 36 612 540 42 re f\n",
    text("F1", 9, 48, 632, "Max hail"),
    text("F2", 12, 48, 616, hailLine),
    text("F1", 9, 190, 632, "Damage score"),
    text("F2", 12, 190, 616, `${proof.level} · ${proof.score}/100`),
    text("F1", 9, 360, 632, "Storm dates"),
    text("F2", 10, 360, 616, dates.slice(0, 42)),
    map,
    confirmBlock(proof),
    nearby,
    text("F2", 11, 36, proof.confirm ? 236 : 250, "Damage score"),
    ...summary.map((line, index) => text("F1", 10, 36, (proof.confirm ? 218 : 232) - index * 14, line, "0.24 0.30 0.40")),
    text("F1", 8, 36, 78, "This is an estimate from Swathline storm evidence. It is not a roof inspection,"),
    text("F1", 8, 36, 66, "an insurance decision, or a guarantee that hail damaged this address."),
    text("F1", 8, 36, 48, `Prepared ${proof.createdAt.slice(0, 10)} · Radar hail and official storm reports · Streets © OpenStreetMap`),
  ].join("");
  return buildPdf(content, image);
}
