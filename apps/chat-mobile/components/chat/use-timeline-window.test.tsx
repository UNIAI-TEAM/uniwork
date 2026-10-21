// The room's sliding window as the reader moves: nothing is dropped while they
// are up in the history; coming back to the newest message drops the oldest
// pages past the window.
import { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import type { RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { chatKeys } from "@/data/queries/chat-keys";
import { KEPT_TIMELINE_PAGES } from "@/data/timeline-window";
import { render } from "@/test/render";
import { useTimelineWindow } from "./use-timeline-window";

function Window({ atLatest }: { atLatest: boolean }) {
  useTimelineWindow("w1", "r1", atLatest);
  return null;
}

const key = chatKeys.roomMessages("w1", "r1");
const timeline = (count: number): RoomTimeline => ({
  pages: Array.from({ length: count }, (_, n) => [{ id: `m${n}` } as ChatMessageRecord]),
  pageParams: Array.from({ length: count }, () => null),
});

it("drops the oldest pages once the reader is back at the newest message, not while they read up there", async () => {
  // gcTime Infinity: an unobserved entry would otherwise arm a five-minute timer that keeps Jest from exiting.
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  queryClient.setQueryData(key, timeline(20));
  const { rerender } = await render(<Window atLatest={false} />, { queryClient });
  expect(queryClient.getQueryData<RoomTimeline>(key)?.pages).toHaveLength(20);
  await rerender(<Window atLatest />);
  expect(queryClient.getQueryData<RoomTimeline>(key)?.pages).toHaveLength(KEPT_TIMELINE_PAGES);
});
