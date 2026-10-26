/** A small PDF 1.4 writer for one branded page. Helvetica, plus one optional RGB map image. */

import { deflateSync } from "node:zlib";

export interface PdfImage {
  width: number;
  height: number;
  rgb: Buffer;
}

function ascii(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, " ");
}

export function pdfText(value: string): string {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function wrapPdfText(value: string, width: number): string[] {
  const words = ascii(value).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildPdf(content: string, image?: PdfImage | null): Buffer {
  const stream = Buffer.from(content.endsWith("\n") ? content : `${content}\n`);
  const flate = image ? deflateSync(image.rgb) : null;
  const resources = image
    ? "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im0 8 0 R >> /ExtGState << /GS1 7 0 R >> >> >>"
    : "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << /GS1 7 0 R >> >> >>";
  const bodies: Array<Buffer | string> = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    resources,
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("endstream")]),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /ExtGState /ca 0.42 /CA 1 >>",
  ];
  if (flate && image) {
    bodies.push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flate.length} >>\nstream\n`,
        ),
        flate,
        Buffer.from("\nendstream"),
      ]),
    );
  }
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  let length = chunks[0].length;
  const offsets: number[] = [];
  bodies.forEach((body, index) => {
    offsets.push(length);
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      typeof body === "string" ? Buffer.from(body) : body,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(wrapped);
    length += wrapped.length;
  });
  const xref = length;
  const tail = [
    `xref\n0 ${bodies.length + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
  ].join("");
  chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}
