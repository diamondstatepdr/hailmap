import { describe, expect, it } from "vitest";
import { resolveSheetGesture } from "@/lib/sheet-gesture";

describe("resolveSheetGesture", () => {
  it("keeps an expanded sheet open for a small downward nudge", () => {
    expect(resolveSheetGesture({ from: "expanded", deltaY: 18, velocityY: 0.05 })).toBe("expanded");
  });

  it("collapses an expanded sheet on a downward swipe", () => {
    expect(resolveSheetGesture({ from: "expanded", deltaY: 72, velocityY: 0.1 })).toBe("collapsed");
  });

  it("collapses an expanded sheet on a short downward flick", () => {
    expect(resolveSheetGesture({ from: "expanded", deltaY: 40, velocityY: 0.7 })).toBe("collapsed");
  });

  it("dismisses an expanded sheet when the drag travels most of the way down", () => {
    expect(resolveSheetGesture({ from: "expanded", deltaY: 168, velocityY: 0.2 })).toBe("dismissed");
  });

  it("dismisses an expanded sheet on a committed downward flick", () => {
    expect(resolveSheetGesture({ from: "expanded", deltaY: 110, velocityY: 0.9 })).toBe("dismissed");
  });

  it("stays expanded when the header is swiped upward", () => {
    expect(resolveSheetGesture({ from: "expanded", deltaY: -48, velocityY: -0.4 })).toBe("expanded");
  });

  it("expands a collapsed sheet on an upward swipe", () => {
    expect(resolveSheetGesture({ from: "collapsed", deltaY: -64, velocityY: -0.2 })).toBe("expanded");
  });

  it("expands a collapsed sheet on an upward flick", () => {
    expect(resolveSheetGesture({ from: "collapsed", deltaY: -16, velocityY: -0.8 })).toBe("expanded");
  });

  it("dismisses a collapsed sheet on a downward swipe", () => {
    expect(resolveSheetGesture({ from: "collapsed", deltaY: 60, velocityY: 0.1 })).toBe("dismissed");
  });

  it("leaves a collapsed sheet collapsed when the drag is too small", () => {
    expect(resolveSheetGesture({ from: "collapsed", deltaY: 12, velocityY: 0.05 })).toBe("collapsed");
  });

  it("dismisses a short sheet that cannot collapse any further", () => {
    expect(resolveSheetGesture({ from: "expanded", deltaY: 70, velocityY: 0.1, collapsible: false })).toBe("dismissed");
    expect(resolveSheetGesture({ from: "expanded", deltaY: 16, velocityY: 0, collapsible: false })).toBe("expanded");
  });
});
