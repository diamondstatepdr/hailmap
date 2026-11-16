import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HelpGuide from "@/components/help/HelpGuide";
import WelcomeFlow from "@/components/welcome/WelcomeFlow";
import { INTRO, introBootScript, shouldShowWelcome, welcomeBlocksChase, friendlyWhen, chipWhen, formatHoneyDetail } from "@/lib/plain";

describe("first-run welcome", () => {
  it("shows one intro to a signed-out first visit, and skips everyone else", () => {
    expect(INTRO.title).toMatch(/hail/i);
    expect(INTRO.tools).toEqual([
      "Door-knock routes",
      "Canvass tracker",
      "Dealership hit list",
      "Hail-proof PDF",
      "Storm-to-cash",
      "Lead export",
    ]);
    expect(shouldShowWelcome(null, "", false)).toBe(true);
    expect(shouldShowWelcome("1", "", false)).toBe(false);
    expect(shouldShowWelcome(null, "", true)).toBe(false);
    expect(shouldShowWelcome("1", "", true)).toBe(false);
    expect(shouldShowWelcome(null, "?day=2026-10-19&lat=32.2&lon=-107.76", false)).toBe(false);
    expect(shouldShowWelcome(null, "?focusLat=35.2&focusLon=-97.4", false)).toBe(false);
    expect(shouldShowWelcome(null, "?west=-102&south=34&east=-99&north=37", false)).toBe(false);
    expect(shouldShowWelcome(null, "?card=address&cardLat=35&cardLon=-97", false)).toBe(false);
    expect(shouldShowWelcome(null, "?section=alerts", false)).toBe(false);
    expect(shouldShowWelcome(null, "?signin=team", false)).toBe(false);
    expect(shouldShowWelcome(null, "?reportId=rpt_1", false)).toBe(false);
    expect(shouldShowWelcome(null, "?replay=1", false)).toBe(false);
    expect(shouldShowWelcome(null, "?honey=1", false)).toBe(false);
    expect(shouldShowWelcome(null, "?theme=dark", false)).toBe(true);
    const boot = introBootScript();
    for (const key of ["day", "date", "lat", "reportId", "signin", "replay", "honey", "focusLat", "card", "section", "west"]) {
      expect(boot).toContain(key);
    }
    expect(boot).toContain("swathline-welcome-seen");
    expect(boot).toContain("swathline_intro");
    expect(welcomeBlocksChase(true, null)).toBe(true);
    expect(welcomeBlocksChase(false, "1")).toBe(true);
    expect(welcomeBlocksChase(false, null)).toBe(false);
  });

  it("renders a skippable one-screen intro with the map and the trial", () => {
    const html = renderToStaticMarkup(createElement(WelcomeFlow, { onDone: () => undefined }));
    expect(html).toContain("<dialog");
    expect(html).toContain("data-welcome");
    expect(html).toContain("Skip");
    expect(html).toContain("Open the free map");
    expect(html).toContain("Start free trial");
    expect(html).toContain("PDR techs and crews");
    expect(html).toContain("$15");
    expect(html).toContain("$119");
    expect(html).toContain("$249");
    expect(html).toContain("7 days free");
    expect(html).toContain("card up front");
    for (const tool of INTRO.tools) expect(html).toContain(tool);
    expect(html).toContain("Amarillo");
    expect(html).toContain("Lubbock");
    expect(html).toContain('2"');
    expect(html).not.toContain("See where hail hit");
    expect(html).not.toContain("data-welcome-next");
    expect(html).not.toContain("welcome-pin-shape");
  });

  it("opens a short guide from the help link copy", () => {
    const html = renderToStaticMarkup(createElement(HelpGuide, { onClose: () => undefined }));
    expect(html).toContain("What do I do here?");
    expect(html).toContain("Hail path");
    expect(html).toContain("Money Hole score");
    expect(html).toContain("Radar size");
    expect(friendlyWhen("All storms · 7 days")).toBe("Hail · 7 days");
    expect(chipWhen("Hail · 7 days")).toBe("7 days");
    expect(chipWhen("All storms · 7 days")).toBe("7 days");
    expect(formatHoneyDetail({ radarIn: 2.23, spotterIn: 1.25, count: 1608, noun: "cars" })).toBe(
      'Hail: 2.2" radar, 1.25" spotter · 1,608 cars',
    );
  });
});
