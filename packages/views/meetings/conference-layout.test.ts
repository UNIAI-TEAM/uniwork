import { describe, expect, it } from "vitest";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  conferenceStagePage,
  copilotPanelShown,
  filterVisibleTracks,
  orderTracks,
  paginate,
  primaryGridClass,
  promoteSpeakers,
  SPEAKER_HOLD_MS,
  speakerSlots,
  resolveConferenceStage,
  splitTracksBySource,
  tileGridClass,
  tileRingTone,
  cameraTileSize,
  screenShareTileSize,
  stageFillSize,
  stripPlacement,
  tileControlButtons,
  trackHasVideo,
  trackTileKey,
} from "./conference-layout";

function track(
  identity: string,
  source: Track.Source = Track.Source.Camera,
  withVideo = true,
): TrackReferenceOrPlaceholder {
  return {
    participant: { identity },
    source,
    publication: withVideo ? { track: {}, isMuted: false } : { track: undefined, isMuted: true },
  } as unknown as TrackReferenceOrPlaceholder;
}

describe("conference layout", () => {
  it("puts pinned participant and screen share first, speakers next", () => {
    const tracks = [track("a"), track("b"), track("c"), track("d", Track.Source.ScreenShare), track("e")];
    const ordered = orderTracks(tracks, ["c", "e"], "b").map(
      (t) => `${t.participant.identity}:${t.source}`,
    );
    expect(ordered).toEqual(["b:camera", "d:screen_share", "c:camera", "e:camera", "a:camera"]);
    expect(orderTracks(tracks, []).map((t) => t.participant.identity)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("keeps a speaker in place when they are already in the main area", () => {
    const r = promoteSpeakers(["a", "b", "c", "d"], {
      cameras: ["a", "b", "c", "d"],
      slots: 6,
      speaking: ["c"],
      lastSpokeAt: new Map(),
      now: 0,
    });
    expect(r.order).toEqual(["a", "b", "c", "d"]);
    expect(r.retryAt).toBeUndefined();
  });

  it("swaps a speaker past the main area with one quiet tile, leaving the rest in place", () => {
    const r = promoteSpeakers(["a", "b", "c", "d", "e"], {
      cameras: ["a", "b", "c", "d", "e"],
      slots: 3,
      speaking: ["e"],
      // b spoke a while ago; a and c never did, so the later slot (c) gives way.
      lastSpokeAt: new Map([["b", 0]]),
      now: 10_000,
    });
    expect(r.order).toEqual(["a", "b", "e", "d", "c"]);
  });

  it("holds a promoted speaker in place for a moment after they stop", () => {
    const cameras = ["x", "a", "b"];
    const first = promoteSpeakers(cameras, { cameras, slots: 1, speaking: ["a"], lastSpokeAt: new Map(), now: 0 });
    expect(first.order).toEqual(["a", "x", "b"]);
    // a went quiet at 1s; b talks straight after and waits out a's hold.
    const held = promoteSpeakers(first.order, {
      cameras,
      slots: 1,
      speaking: ["b"],
      lastSpokeAt: new Map([["a", 1_000]]),
      now: 1_200,
    });
    expect(held.order).toEqual(["a", "x", "b"]);
    expect(held.retryAt).toBe(1_000 + SPEAKER_HOLD_MS);
    const later = promoteSpeakers(held.order, {
      cameras,
      slots: 1,
      speaking: ["b"],
      lastSpokeAt: new Map([["a", 1_000], ["b", 3_500]]),
      now: 1_000 + SPEAKER_HOLD_MS,
    });
    expect(later.order).toEqual(["b", "x", "a"]);
    expect(later.retryAt).toBeUndefined();
  });

  it("never displaces someone who is still speaking", () => {
    const cameras = ["a", "b"];
    const r = promoteSpeakers(cameras, { cameras, slots: 1, speaking: ["a", "b"], lastSpokeAt: new Map(), now: 0 });
    expect(r.order).toEqual(["a", "b"]);
    // Nothing frees up on a timer: the next speaking change re-runs it.
    expect(r.retryAt).toBeUndefined();
  });

  it("drops people who left and appends newcomers in the room's order", () => {
    const r = promoteSpeakers(["c", "a", "gone"], {
      cameras: ["a", "b", "c"],
      slots: 2,
      speaking: [],
      lastSpokeAt: new Map(),
      now: 0,
    });
    expect(r.order).toEqual(["c", "a", "b"]);
  });

  it("counts the main-area slots a speaker may be promoted into", () => {
    const nine = Array.from({ length: 9 }, (_, i) => track(String(i)));
    expect(speakerSlots(nine, { layout: "auto", maxTiles: 6 })).toEqual({
      cameras: nine.map((t) => t.participant.identity),
      slots: 6,
    });
    expect(speakerSlots(nine, { layout: "spotlight", maxTiles: 6 }).slots).toBe(1);
    expect(speakerSlots(nine, { layout: "tiled", maxTiles: 9 }).slots).toBe(9);
    // The pinned tile has its own place; one fewer slot for speakers.
    const pinned = speakerSlots(nine, { layout: "auto", maxTiles: 6, pinnedIdentity: "4" });
    expect(pinned.slots).toBe(5);
    expect(pinned.cameras).not.toContain("4");
    // Beside a shared screen the first strip page is what the viewer sees.
    const shared = speakerSlots([...nine, track("s", Track.Source.ScreenShare)], { layout: "auto", maxTiles: 6 });
    expect(shared.slots).toBe(5);
    expect(shared.cameras).toHaveLength(9);
  });

  it("does not reorder the grid while everyone fits on the stage", () => {
    const tracks = Array.from({ length: 4 }, (_, i) => track(String(i)));
    const stage = resolveConferenceStage(tracks, {
      layout: "auto",
      maxTiles: 6,
      page: 0,
      speakerOrder: ["0", "1", "2", "3"],
    });
    expect(stage.primary.map((t) => t.participant.identity)).toEqual(["0", "1", "2", "3"]);
  });

  it("lays tiles out in the speaker order it is given", () => {
    const tracks = Array.from({ length: 9 }, (_, i) => track(String(i)));
    const stage = resolveConferenceStage(tracks, {
      layout: "auto",
      maxTiles: 6,
      page: 0,
      speakerOrder: ["0", "1", "2", "3", "4", "8", "6", "7", "5"],
    });
    expect(stage.primary.map((t) => t.participant.identity)).toEqual(["0", "1", "2", "3", "4", "8"]);
    expect(stage.thumbnails.map((t) => t.participant.identity)).toEqual(["6", "7", "5"]);
  });

  it("paginates and clamps the page", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(paginate(items, 0).items).toHaveLength(9);
    expect(paginate(items, 2)).toEqual({ items: [18, 19], pages: 3, page: 2 });
    expect(paginate(items, 99).page).toBe(2);
    expect(paginate([], 0)).toEqual({ items: [], pages: 1, page: 0 });
  });

  it("never exceeds three columns", () => {
    expect(tileGridClass(1)).toBe("grid-cols-1");
    expect(tileGridClass(9)).toBe("grid-cols-3");
    expect(primaryGridClass(6)).toBe("grid-cols-2 lg:grid-cols-3");
  });

  it("splits cameras from screen shares", () => {
    const tracks = [track("a"), track("b", Track.Source.ScreenShare)];
    expect(splitTracksBySource(tracks)).toEqual({
      cameras: [track("a")],
      screenShares: [track("b", Track.Source.ScreenShare)],
    });
  });

  it("pages primary grid and thumbnail strip together", () => {
    const cameras = Array.from({ length: 14 }, (_, i) => track(String(i)));
    const first = conferenceStagePage(cameras, 0);
    expect(first.primary).toHaveLength(6);
    expect(first.thumbnails).toHaveLength(5);
    expect(first.overflow).toBe(3);
    expect(first.pages).toBe(2);
  });

  it("filters hidden participants and camera tiles without video", () => {
    const tracks = [track("a"), track("b", Track.Source.Camera, false), track("c")];
    expect(filterVisibleTracks(tracks, ["a"], false).map((t) => t.participant.identity)).toEqual([
      "b",
      "c",
    ]);
    expect(filterVisibleTracks(tracks, [], true).map((t) => t.participant.identity)).toEqual(["a", "c"]);
    expect(trackHasVideo(track("a"))).toBe(true);
    expect(trackHasVideo(track("b", Track.Source.Camera, false))).toBe(false);
  });

  it("promotes screen share to the primary stage with cameras in the side strip", () => {
    const tracks = [
      track("a"),
      track("b"),
      track("c"),
      track("presenter", Track.Source.ScreenShare),
    ];
    const stage = resolveConferenceStage(tracks, {
      layout: "auto",
      maxTiles: 6,
      page: 0,
      pinnedIdentity: "b",
    });
    expect(stage.layoutMode).toBe("sidebar");
    expect(stage.primary).toHaveLength(1);
    expect(stage.primary[0]?.source).toBe(Track.Source.ScreenShare);
    expect(stage.primary[0]?.participant.identity).toBe("presenter");
    expect(stage.thumbnails.map((t) => t.participant.identity)).toEqual(["b", "a", "c"]);
  });

  it("pages extra screen shares in the strip after the first share", () => {
    const tracks = [
      track("share-a", Track.Source.ScreenShare),
      track("share-b", Track.Source.ScreenShare),
      track("cam-a"),
      track("cam-b"),
    ];
    const stage = resolveConferenceStage(tracks, {
      layout: "auto",
      maxTiles: 6,
      page: 0,
    });
    expect(stage.primary).toHaveLength(1);
    expect(stage.primary[0]?.participant.identity).toBe("share-a");
    expect(stage.thumbnails.map((t) => t.participant.identity)).toEqual(["share-b", "cam-a", "cam-b"]);
  });

  it("resolves spotlight and tiled layouts", () => {
    const tracks = Array.from({ length: 8 }, (_, i) => track(String(i)));
    const spotlight = resolveConferenceStage(tracks, {
      layout: "spotlight",
      maxTiles: 6,
      page: 0,
      speakerOrder: ["3", "0", "1", "2", "4", "5", "6", "7"],
    });
    expect(spotlight.layoutMode).toBe("spotlight");
    expect(spotlight.primary).toHaveLength(1);
    expect(spotlight.primary[0]?.participant.identity).toBe("3");

    const tiled = resolveConferenceStage(tracks, {
      layout: "tiled",
      maxTiles: 4,
      page: 0,
    });
    expect(tiled.layoutMode).toBe("grid");
    expect(tiled.primary).toHaveLength(4);
    expect(tiled.thumbnails).toHaveLength(0);
  });

  it("resolves sidebar and auto grid layouts without screen share", () => {
    const tracks = Array.from({ length: 10 }, (_, i) => track(String(i)));
    const sidebar = resolveConferenceStage(tracks, {
      layout: "sidebar",
      maxTiles: 5,
      page: 0,
      speakerOrder: ["2", "0", "1"],
    });
    expect(sidebar.layoutMode).toBe("sidebar");
    expect(sidebar.primary[0]?.participant.identity).toBe("2");
    expect(sidebar.thumbnails).toHaveLength(4);

    const auto = resolveConferenceStage(tracks, {
      layout: "auto",
      maxTiles: 6,
      page: 0,
    });
    expect(auto.layoutMode).toBe("grid");
    expect(auto.primary.length).toBeGreaterThan(0);
    expect(auto.gridClass).toContain("grid-cols");
  });

  it("builds stable track keys", () => {
    const t = track("alice");
    expect(trackTileKey(t)).toBe(`alice:${String(Track.Source.Camera)}`);
  });

  it("respects hidden participants and hide-without-video in tiled layout", () => {
    const tracks = [track("a"), track("b", Track.Source.Camera, false), track("c")];
    const stage = resolveConferenceStage(tracks, {
      layout: "tiled",
      maxTiles: 6,
      page: 0,
      hiddenIdentities: ["c"],
      hideWithoutVideo: true,
    });
    expect(stage.primary.map((t) => t.participant.identity)).toEqual(["a"]);
  });

  it("pages spotlight thumbnails beyond the first strip", () => {
    const tracks = Array.from({ length: 12 }, (_, i) => track(String(i)));
    const page1 = resolveConferenceStage(tracks, {
      layout: "spotlight",
      maxTiles: 6,
      page: 1,
    });
    expect(page1.page).toBe(1);
    expect(page1.primary).toHaveLength(1);
    expect(page1.thumbnails.length).toBeGreaterThan(0);
  });

  it("keeps screen shares visible even when hide-without-video is enabled", () => {
    const tracks = [track("cam-off", Track.Source.Camera, false), track("share", Track.Source.ScreenShare)];
    const stage = resolveConferenceStage(tracks, {
      layout: "auto",
      maxTiles: 6,
      page: 0,
      hideWithoutVideo: true,
    });
    expect(stage.primary[0]?.source).toBe(Track.Source.ScreenShare);
    expect(stage.thumbnails.map((t) => t.participant.identity)).toEqual([]);
  });
});

describe("copilotPanelShown", () => {
  it("follows the sheet on compact screens, not the desktop pin", () => {
    // The pin defaults to open; on a phone the panel is a Sheet, and while
    // that Sheet is closed the AI control must not read as pressed.
    expect(copilotPanelShown({ tab: "copilot", compact: true, sheetOpen: false, pinned: true })).toBe(false);
    expect(copilotPanelShown({ tab: "copilot", compact: true, sheetOpen: true, pinned: false })).toBe(true);
  });

  it("follows the pinned side panel on wide screens", () => {
    expect(copilotPanelShown({ tab: "copilot", compact: false, sheetOpen: true, pinned: false })).toBe(false);
    expect(copilotPanelShown({ tab: "copilot", compact: false, sheetOpen: false, pinned: true })).toBe(true);
  });

  it("is off whenever another tab is showing", () => {
    expect(copilotPanelShown({ tab: "chat", compact: false, sheetOpen: false, pinned: true })).toBe(false);
    expect(copilotPanelShown({ tab: "chat", compact: true, sheetOpen: true, pinned: true })).toBe(false);
  });
});

describe("tileRingTone", () => {
  it("puts a raised hand above speaking and pinning: it asks for attention", () => {
    expect(tileRingTone({ handRaised: true, speaking: true, pinned: true })).toBe("hand");
  });

  it("shows who is speaking, even on the pinned tile", () => {
    expect(tileRingTone({ handRaised: false, speaking: true, pinned: true })).toBe("speaking");
  });

  it("marks a pinned tile when nothing more urgent applies, else stays idle", () => {
    expect(tileRingTone({ handRaised: false, speaking: false, pinned: true })).toBe("pinned");
    expect(tileRingTone({ handRaised: false, speaking: false, pinned: false })).toBe("idle");
  });
});

describe("cameraTileSize", () => {
  it("never makes a tile wider than its video, and lets it narrow by at most 1.3×", () => {
    expect(cameraTileSize(16 / 9)).toEqual({
      width: "min(100cqw, calc(100cqh * 1.7778))",
      height: "min(100cqh, calc(100cqw * 0.7313))",
    });
  });

  it("follows a portrait camera and falls back to 16:9 without a size", () => {
    expect(cameraTileSize(9 / 16).width).toBe("min(100cqw, calc(100cqh * 0.5625))");
    expect(cameraTileSize(0)).toEqual(cameraTileSize(16 / 9));
    expect(cameraTileSize(Number.NaN)).toEqual(cameraTileSize(16 / 9));
  });
});

describe("screenShareTileSize", () => {
  it("takes the shared screen's exact shape, with no side crop", () => {
    expect(screenShareTileSize(16 / 10)).toEqual({
      width: "min(100cqw, calc(100cqh * 1.6))",
      height: "min(100cqh, calc(100cqw * 0.625))",
    });
    expect(screenShareTileSize(0)).toEqual(screenShareTileSize(16 / 9));
  });
});

describe("tile sizes beside a presentation strip", () => {
  it("leave the strip's room the stage publishes", () => {
    expect(screenShareTileSize(2, true)).toEqual({
      width: "min((100cqw - var(--strip-reserve-x, 0px)), calc((100cqh - var(--strip-reserve-y, 0px)) * 2))",
      height: "min((100cqh - var(--strip-reserve-y, 0px)), calc((100cqw - var(--strip-reserve-x, 0px)) * 0.5))",
    });
    expect(stageFillSize()).toEqual({
      width: "calc(100cqw - var(--strip-reserve-x, 0px))",
      height: "calc(100cqh - var(--strip-reserve-y, 0px))",
    });
  });
});

describe("stripPlacement", () => {
  it("puts the strip beside a wide stage and under a tall or narrow one", () => {
    expect(stripPlacement(1870, 640)).toBe("beside"); // wide desktop, panel closed
    expect(stripPlacement(740, 820)).toBe("below"); // portrait tablet
    expect(stripPlacement(342, 600)).toBe("below"); // phone
    expect(stripPlacement(660, 590)).toBe("below"); // narrow stage beside the side panel
  });

  it("measures the strip's room in the page's rem", () => {
    // At 200% text a strip under a short stage eats more of its height, which
    // tips a borderline stage to a strip beside.
    expect(stripPlacement(600, 360, 16)).toBe("below");
    expect(stripPlacement(600, 360, 32)).toBe("beside");
  });
});

describe("tileControlButtons", () => {
  it("counts what a full tile's corner controls draw", () => {
    expect(tileControlButtons({ screenShare: false, hostMute: false })).toBe(2); // pin + menu
    expect(tileControlButtons({ screenShare: false, hostMute: true })).toBe(3); // + mute
    expect(tileControlButtons({ screenShare: true, hostMute: true })).toBe(2); // mute + menu
    expect(tileControlButtons({ screenShare: true, hostMute: false })).toBe(0); // no controls
  });
});
