import { readFileSync } from "node:fs";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import BottomSheet from "@/components/ui/BottomSheet";

describe("bottom sheet chrome", () => {
  it("renders a header drag handle and a close button", () => {
    const html = renderToStaticMarkup(
      createElement(BottomSheet, { label: "Field", onClose: () => undefined }, createElement("p", null, "Damage probability")),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Field"');
    expect(html).toContain('data-bottom-sheet');
    expect(html).toContain('data-sheet-state="expanded"');
    expect(html).toContain('data-sheet-grab');
    expect(html).toContain("sheet-handle");
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain("sheet-close");
    expect(html).toContain("Damage probability");
    expect(html).toContain('data-sheet-scroll="true"');
  });

  it("locks pull-to-refresh on the document and sheet scrollers", () => {
    const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const rootStart = css.indexOf("html,\nbody {");
    const root = css.slice(rootStart, css.indexOf("}", rootStart));
    expect(root).toMatch(/overscroll-behavior:\s*none/);
    expect(css).toMatch(/\.sheet-grab\s*\{[^}]*touch-action:\s*none/);
    expect(css).toMatch(/\.sheet-body\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).toMatch(/\.sheet-close\s*\{[^}]*width:\s*44px;/);
    expect(css).toMatch(/\.sheet-close\s*\{[^}]*height:\s*44px;/);
    expect(css).toMatch(/\.honey-body\s*\{[^}]*overscroll-behavior:\s*contain/);
    expect(css).not.toMatch(/\.maplibregl-canvas[\s\S]{0,120}touch-action:\s*none/);
  });
});
