"use client";

import { useState } from "react";

export async function shareHailProof(draft: unknown): Promise<void> {
  const response = await fetch("/api/hail-proof", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
  const payload = (await response.json()) as { error?: string; pdfUrl?: string; filename?: string; url?: string };
  if (!response.ok || !payload.pdfUrl || !payload.filename) throw new Error(payload.error ?? "Could not make the PDF");
  const pdf = await fetch(payload.pdfUrl);
  if (!pdf.ok) throw new Error("Could not download the PDF");
  const blob = await pdf.blob();
  const file = new File([blob], payload.filename, { type: "application/pdf" });
  const canShare = typeof navigator.canShare === "function" ? navigator.canShare({ files: [file] }) : false;
  if (typeof navigator.share === "function" && canShare) {
    await navigator.share({ files: [file], title: "Swathline hail proof", text: payload.filename });
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ProofActions({ id, filename, address }: { id: string; filename: string; address: string }) {
  const [note, setNote] = useState<string | null>(null);
  const pdfUrl = `/api/hail-proof/${id}`;

  async function share() {
    setNote(null);
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error("Could not download the PDF");
      const blob = await response.blob();
      const file = new File([blob], filename, { type: "application/pdf" });
      if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file], title: "Swathline hail proof", text: address });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNote("Could not share that PDF. Use Download.");
    }
  }

  return (
    <div className="proof-actions">
      <a className="btn btn-primary press" href={pdfUrl} download={filename}>
        Download PDF
      </a>
      <button type="button" className="btn btn-secondary press" onClick={() => void share()}>
        Share
      </button>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </div>
  );
}
