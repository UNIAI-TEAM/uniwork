import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createRoomTimelineCache, markStaleUnlessObserved, roomTimelineFetchInFlight } from "./room-timeline-cache";

// The source-independent edges of the shared timeline cache; room-timeline.test.ts
// runs the operations as the web binds them, and the phone's chat-timeline.test.ts
// as it binds them.
const key = ["chat", "ws1", "room-messages", "room1"];

describe("room-timeline-cache", () => {
  it("waits out a failing fetch in flight without throwing (the query reports it)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const fetching = qc.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(new Error("down")) }).catch(() => "reported");
    await expect(roomTimelineFetchInFlight(qc, key)).resolves.toBeUndefined();
    await expect(fetching).resolves.toBe("reported");
    expect(roomTimelineFetchInFlight(qc, key)).toBeUndefined();
  });

  it("treats a key with no query as not shown", () => {
    expect(markStaleUnlessObserved(new QueryClient(), key)).toBe(false);
  });

  it("answers only a chat subscribe ack that names a room", () => {
    const listMessagesAfter = vi.fn(async () => []);
    const cache = createRoomTimelineCache({ roomMessagesKey: () => key, listMessagesAfter });
    const qc = new QueryClient();
    expect(cache.catchUpOnChatSubscribeAck(qc, "ws1", "subscribe_ack", { scope: "chat", id: "room1" })).toBe(true);
    expect(cache.catchUpOnChatSubscribeAck(qc, "ws1", "subscribe_ack", { scope: "meeting", id: "m1" })).toBe(false);
    expect(cache.catchUpOnChatSubscribeAck(qc, "ws1", "subscribe_ack", { scope: "chat" })).toBe(false);
    expect(cache.catchUpOnChatSubscribeAck(qc, "ws1", "chat.message.created", { scope: "chat", id: "room1" })).toBe(false);
    // Nothing is loaded for the room, so the catch-up reads nothing.
    expect(listMessagesAfter).not.toHaveBeenCalled();
  });
});
