// The last line of defence of audit R4: a catch-up read that itself fails
// (it settles on its own today; this pins what happens if it ever rejects)
// still refetches the room instead of losing the frames.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({ api: { request: vi.fn() } }));
vi.mock("../chat-timeline", async (original) => ({
  ...(await original<typeof import("../chat-timeline")>()),
  catchUpRoomTimeline: vi.fn(() => Promise.reject(new Error("catch-up failed"))),
}));

import { chatApi } from "../chat-api";
import { chatKeys } from "../queries/chat-keys";
import { createChatRealtime, type ChatRealtimeDeps } from "./chat-realtime";

const deps: ChatRealtimeDeps = {
  wsId: "w1",
  viewer: () => ({ userId: "u1", activeRoomId: null }),
  typing: { bump: vi.fn() },
  presence: { bump: vi.fn(), markOffline: vi.fn() },
};
afterEach(() => vi.restoreAllMocks());

describe("a catch-up that fails", () => {
  it("refetches the room, for a failed GET and for a burst", async () => {
    const qc = new QueryClient();
    const key = chatKeys.roomMessages("w1", "r1");
    qc.setQueryData(key, { pages: [[]], pageParams: [null] });
    new QueryObserver(qc, { queryKey: key, enabled: false }).subscribe(() => {});
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    let fail: (error: unknown) => void = () => undefined;
    vi.spyOn(chatApi, "getMessage").mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    const realtime = createChatRealtime(qc, deps);
    realtime.handle({ type: "chat.message.created", payload: { room_id: "r1", message_id: "m1" } });
    realtime.handle({ type: "chat.message.created", payload: { room_id: "r1", message_id: "m2" } });
    realtime.handle({ type: "chat.message.created", payload: { room_id: "r1", message_id: "m3" } });
    fail(new TypeError("offline"));
    await vi.waitFor(() => expect(invalidate.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(key)).length).toBeGreaterThanOrEqual(2));
  });
});
