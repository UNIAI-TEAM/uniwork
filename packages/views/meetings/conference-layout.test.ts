import { describe, expect, it } from "vitest";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { orderTracks, paginate, tileGridClass } from "./conference-layout";

function track(identity: string, source: Track.Source = Track.Source.Camera): TrackReferenceOrPlaceholder {
  return { participant: { identity }, source } as unknown as TrackReferenceOrPlaceholder;
}

describe("conference layout", () => {
  it("puts screen share first, speakers next, keeps the rest stable", () => {
    const tracks = [track("a"), track("b"), track("c"), track("d", Track.Source.ScreenShare), track("e")];
    const ordered = orderTracks(tracks, ["c", "e"]).map((t) => `${t.participant.identity}:${t.source}`);
    expect(ordered).toEqual(["d:screen_share", "c:camera", "e:camera", "a:camera", "b:camera"]);
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
  });
});
