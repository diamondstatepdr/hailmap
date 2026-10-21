import { describe, expect, it } from "vitest";
import { chaseFrameResult, describeOpening, stormDayFromLink, type ChaseFrameState } from "@/lib/chase-frame";
import type { SavedView } from "@/lib/view-scope";

const FORT_WORTH = "/?honey=1&day=2026-04-25&west=-97.55&south=32.55&east=-97.05&north=32.95&mode=pdr";

function params(search: string): URLSearchParams {
  return new URL(search, "https://hailmap.local").searchParams;
}

function state(partial: Partial<ChaseFrameState>): ChaseFrameState {
  return {
    chaseReady: true,
    popupOpen: false,
    autoOpen: false,
    requestedView: false,
    userMoved: false,
    replayActive: false,
    flyingToStop: false,
    nationalShown: false,
    ...partial,
  };
}

const saved: SavedView = { lat: 32.75, lon: -97.33, zoom: 11 };

describe("opening view", () => {
  it("keeps the Fort Worth Money Hole day and treats the share link as a requested view", () => {
    const opening = describeOpening(params(FORT_WORTH), null);
    expect(opening.honey).toBe(true);
    expect(opening.day).toBe("2026-04-25");
    expect(opening.bounds).toBe(true);
    expect(stormDayFromLink(params(FORT_WORTH))).toBe("2026-04-25");
    expect(opening.requestsView).toBe(true);
  });

  it("treats honey, bounds, center, day, address, and saved views as requested cameras", () => {
    expect(describeOpening(params("/?honey=1"), null).requestsView).toBe(true);
    expect(describeOpening(params("/?west=-97.6&south=32.5&east=-97.0&north=33.0"), null).requestsView).toBe(true);
    expect(describeOpening(params("/?lat=32.75&lon=-97.33&z=11"), null).requestsView).toBe(true);
    expect(describeOpening(params("/?day=2026-04-25"), null).day).toBe("2026-04-25");
    expect(describeOpening(params("/?date=2026-04-25&west=-97.6&south=32.5&east=-97.0&north=33.0"), null).day).toBe(
      "2026-04-25",
    );
    expect(describeOpening(params("/?focusLat=32.75&focusLon=-97.33&card=address"), null).requestsView).toBe(true);
    expect(describeOpening(params("/"), saved).requestsView).toBe(true);
    expect(describeOpening(params("/"), null).requestsView).toBe(false);
    expect(describeOpening(params("/?day=not-a-day"), null).day).toBeNull();
  });
});

describe("national chase frame", () => {
  it("does not frame the US or drop the lock when a share link, map link, or saved view is open", () => {
    const loaded = chaseFrameResult(state({ requestedView: true, popupOpen: false, autoOpen: true }));
    const popped = chaseFrameResult(state({ requestedView: true, popupOpen: true, autoOpen: true }));
    expect(loaded).toEqual({ frameUnitedStates: false, lockFrame: true });
    expect(popped).toEqual({ frameUnitedStates: false, lockFrame: true });
  });

  it("frames the US only when the weekly popup auto-opens with no other view", () => {
    expect(chaseFrameResult(state({ popupOpen: true, autoOpen: true }))).toEqual({
      frameUnitedStates: true,
      lockFrame: true,
    });
    expect(chaseFrameResult(state({ popupOpen: false, autoOpen: true }))).toEqual({
      frameUnitedStates: false,
      lockFrame: true,
    });
  });

  it("does not frame the US when the sheet is opened from the map, after it closes, or before chase loads", () => {
    expect(chaseFrameResult(state({ popupOpen: true, autoOpen: false }))).toEqual({
      frameUnitedStates: false,
      lockFrame: true,
    });
    expect(chaseFrameResult(state({ popupOpen: false, autoOpen: false, nationalShown: true }))).toEqual({
      frameUnitedStates: false,
      lockFrame: true,
    });
    expect(chaseFrameResult(state({ chaseReady: false, popupOpen: true, autoOpen: true }))).toEqual({
      frameUnitedStates: false,
      lockFrame: true,
    });
  });

  it("leaves a visitor-moved map, a replay, and a chase-stop flight alone", () => {
    expect(chaseFrameResult(state({ popupOpen: true, autoOpen: true, userMoved: true })).frameUnitedStates).toBe(false);
    expect(chaseFrameResult(state({ popupOpen: true, autoOpen: true, replayActive: true })).frameUnitedStates).toBe(false);
    expect(chaseFrameResult(state({ popupOpen: true, autoOpen: true, flyingToStop: true })).frameUnitedStates).toBe(false);
    expect(chaseFrameResult(state({ popupOpen: true, autoOpen: true, userMoved: true })).lockFrame).toBe(true);
  });

  it("can refit the country for the sheet padding until the visitor moves the map", () => {
    const open = { popupOpen: true, autoOpen: true, nationalShown: true };
    expect(chaseFrameResult(state(open)).frameUnitedStates).toBe(true);
    expect(chaseFrameResult(state({ ...open, userMoved: true })).frameUnitedStates).toBe(false);
  });

  it("releases the lock only when chase is idle and nobody asked for a view", () => {
    expect(chaseFrameResult(state({}))).toEqual({ frameUnitedStates: false, lockFrame: false });
  });
});
