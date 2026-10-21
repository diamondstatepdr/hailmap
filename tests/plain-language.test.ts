import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HelpGuide from "@/components/help/HelpGuide";
import WelcomeFlow from "@/components/welcome/WelcomeFlow";
import { shouldShowWelcome, WELCOME_SCREENS, welcomeBlocksChase, friendlyWhen, formatHoneyDetail } from "@/lib/plain";

describe("first-run welcome", () => {
  it("shows three plain screens once, and skips share links", () => {
    expect(WELCOME_SCREENS.map((screen) => screen.title)).toEqual([
      "See where hail hit",
      "Find the best money spots",
      "Work the area",
    ]);
    expect(shouldShowWelcome(null, "")).toBe(true);
    expect(shouldShowWelcome("1", "")).toBe(false);
    expect(shouldShowWelcome(null, "?day=2026-10-19&lat=32.2&lon=-107.76")).toBe(false);
    expect(welcomeBlocksChase(true, null)).toBe(true);
    expect(welcomeBlocksChase(false, "1")).toBe(true);
    expect(welcomeBlocksChase(false, null)).toBe(false);
  });

  it("renders a skippable intro", () => {
    const html = renderToStaticMarkup(createElement(WelcomeFlow, { onDone: () => undefined }));
    expect(html).toContain('data-welcome');
    expect(html).toContain("See where hail hit");
    expect(html).toContain("Skip");
    expect(html).toContain('data-welcome-next');
    expect(html).toContain("welcome-band");
    expect(html).toContain("welcome-pin-shape");
  });

  it("opens a short guide from the help link copy", () => {
    const html = renderToStaticMarkup(createElement(HelpGuide, { onClose: () => undefined }));
    expect(html).toContain("What do I do here?");
    expect(html).toContain("Hail path");
    expect(html).toContain("Money Hole score");
    expect(html).toContain("Radar size");
    expect(friendlyWhen("All storms · 7 days")).toBe("Hail · 7 days");
    expect(formatHoneyDetail({ radarIn: 2.23, spotterIn: 1.25, count: 1608, noun: "cars" })).toBe(
      'Hail: 2.2" radar, 1.25" spotter · 1,608 cars',
    );
  });
});
