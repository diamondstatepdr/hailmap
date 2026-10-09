"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      className="no-print rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accentink"
      onClick={() => window.print()}
    >
      Print or save as PDF
    </button>
  );
}
