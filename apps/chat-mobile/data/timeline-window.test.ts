import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import type { RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { describe, expect, it } from "vitest";
import { chatKeys } from "./queries/chat-keys";
import { KEPT_TIMELINE_PAGES, trimRoomTimelineTail } from "./timeline-window";

const key = chatKeys.roomMessages("ws1", "room1");
const page = (n: number) => [{ id: `m${n}` } as ChatMessageRecord];
const timeline = (count: number): RoomTimeline => ({
  pages: Array.from({ length: count }, (_, n) => page(n)),
  pageParams: Array.from({ length: count }, (_, n) => (n === 0 ? null : { before: `c${n}` }) as RoomTimeline["pageParams"][number]),
});

describe("trimRoomTimelineTail", () => {
  it("keeps the newest pages and their cursors, dropping the oldest past the window", () => {
    const qc = new QueryClient();
    qc.setQueryData(key, timeline(20));
    expect(trimRoomTimelineTail(qc, "ws1", "room1")).toBe(true);
    const kept = qc.getQueryData<RoomTimeline>(key);
    expect(kept?.pages).toEqual(timeline(KEPT_TIMELINE_PAGES).pages);
    expect(kept?.pageParams).toEqual(timeline(KEPT_TIMELINE_PAGES).pageParams);
  });

  it("leaves a timeline within the window, or none, as it is", () => {
    const qc = new QueryClient();
    expect(trimRoomTimelineTail(qc, "ws1", "room1")).toBe(false);
    const short = timeline(KEPT_TIMELINE_PAGES);
    qc.setQueryData(key, short);
    expect(trimRoomTimelineTail(qc, "ws1", "room1")).toBe(false);
    expect(qc.getQueryData(key)).toBe(short);
  });

  it("does not cut while a page is on its way: the fetch would write the old pages back", async () => {
    const qc = new QueryClient();
    let answer: (value: ChatMessageRecord[]) => void = () => undefined;
    const observer = new InfiniteQueryObserver(qc, {
      queryKey: key,
      queryFn: () => new Promise<ChatMessageRecord[]>((resolve) => (answer = resolve)),
      initialPageParam: null,
      getNextPageParam: () => undefined,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    qc.setQueryData(key, timeline(12));
    expect(qc.getQueryState(key)?.fetchStatus).toBe("fetching");
    expect(trimRoomTimelineTail(qc, "ws1", "room1", 2)).toBe(false);
    expect(qc.getQueryData<RoomTimeline>(key)?.pages).toHaveLength(12);
    answer(page(0));
    unsubscribe();
  });
});
