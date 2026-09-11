import { describe, expect, it } from "vitest";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  conferenceStagePage,
  filterVisibleTracks,
  orderTracks,
  paginate,
  primaryGridClass,
  resolveConferenceStage,
  splitTracksBySource,
  tileGridClass,
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
      speakingIdentities: ["3"],
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
      speakingIdentities: ["2"],
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
