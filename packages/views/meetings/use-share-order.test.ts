import { renderHook } from "@testing-library/react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";
import { Track } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShareOrder } from "./use-share-order";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});
afterEach(() => {
  vi.useRealTimers();
});

function share(identity: string, trackSid: string): TrackReferenceOrPlaceholder {
  return {
    participant: { identity },
    source: Track.Source.ScreenShare,
    publication: { track: {}, isMuted: false, trackSid },
  } as unknown as TrackReferenceOrPlaceholder;
}
const camera = (identity: string) =>
  ({ participant: { identity }, source: Track.Source.Camera }) as unknown as TrackReferenceOrPlaceholder;

type Props = { tracks: TrackReferenceOrPlaceholder[] };

describe("useShareOrder", () => {
  it("puts the share this client saw last first, whatever order the room lists them in", () => {
    const { result, rerender } = renderHook(({ tracks }: Props) => useShareOrder(tracks), {
      initialProps: { tracks: [camera("cam"), share("zed", "TR_old")] },
    });
    expect(result.current).toEqual(["TR_old"]);

    vi.setSystemTime(2_000);
    // The presenter's own share is listed first by LiveKit; the newcomer is still newer.
    rerender({ tracks: [share("amy", "TR_new"), share("zed", "TR_old")] });
    expect(result.current).toEqual(["TR_new", "TR_old"]);

    vi.setSystemTime(3_000);
    rerender({ tracks: [share("zed", "TR_old"), share("amy", "TR_new")] });
    expect(result.current).toEqual(["TR_new", "TR_old"]);
  });

  it("treats a share started again as new, and keeps the same order between changes", () => {
    const { result, rerender } = renderHook(({ tracks }: Props) => useShareOrder(tracks), {
      initialProps: { tracks: [share("zed", "TR_1"), share("amy", "TR_2")] },
    });
    // Seen together: the tie goes to the greater identity.
    expect(result.current).toEqual(["TR_1", "TR_2"]);
    const first = result.current;
    rerender({ tracks: [share("zed", "TR_1"), share("amy", "TR_2")] });
    expect(result.current).toBe(first);

    vi.setSystemTime(5_000);
    rerender({ tracks: [share("amy", "TR_2")] });
    vi.setSystemTime(6_000);
    rerender({ tracks: [share("zed", "TR_3"), share("amy", "TR_2")] });
    expect(result.current).toEqual(["TR_3", "TR_2"]);
  });
});
