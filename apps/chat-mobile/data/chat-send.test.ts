// Spec §3 / §5: a message sent offline shows as waiting, goes once the
// network is back, and reaches the room once (client_msg_id), however many
// flushes or retries race for it.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { flattenRoomTimeline, type RoomTimeline } from "./chat-timeline";
import { chatSendDeps, deliverPendingSend, discardPendingSend, flushQueuedSends, sendChatMessage, type ChatSendDeps } from "./chat-send";
import { chatKeys } from "./queries/chat-keys";
import { selectRoomSends, useChatSendStore } from "./stores/chat-send-store";

const echo = (clientMsgId: string, extra: Partial<ChatMessageRecord> = {}): ChatMessageRecord => ({
  id: `m-${clientMsgId}`,
  room_id: "r1",
  workspace_id: "w1",
  sender_id: "u1",
  sender_display_name: "An",
  kind: "text",
  body: "hi",
  created_at: "2026-10-17T10:00:00Z",
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
  client_msg_id: clientMsgId,
  ...extra,
});

const apiError = (status: number) => Object.assign(new Error(String(status)), { status });

let online = true;
let server: Map<string, ChatMessageRecord>;
const sendMessage = vi.fn<ChatSendDeps["api"]["sendMessage"]>();
const sendThreadMessage = vi.fn<ChatSendDeps["api"]["sendThreadMessage"]>();
const sendFileMessage = vi.fn<ChatSendDeps["api"]["sendFileMessage"]>();
const deps: ChatSendDeps = {
  api: { sendMessage, sendThreadMessage, sendFileMessage },
  isOnline: () => online,
  retry: (fn) => fn(),
};

/** The server's idempotency: one message per client_msg_id, whatever the number of posts. */
function idempotentServer() {
  return async (_ws: string, _room: string, input: { client_msg_id: string }) => {
    if (!online) throw new TypeError("Network request failed");
    const existing = server.get(input.client_msg_id) ?? echo(input.client_msg_id);
    server.set(input.client_msg_id, existing);
    return existing;
  };
}

function shownTimeline(qc: QueryClient) {
  const key = chatKeys.roomMessages("w1", "r1");
  qc.setQueryData<RoomTimeline>(key, { pages: [[]], pageParams: [null] });
  new QueryObserver(qc, { queryKey: key, enabled: false }).subscribe(() => {});
  return () => flattenRoomTimeline(qc.getQueryData<RoomTimeline>(key)!).map((m) => m.id);
}

const input = { workspaceId: "w1", roomId: "r1", senderId: "u1", body: "hi" };
const statuses = () => useChatSendStore.getState().entries.map((entry) => entry.status);

beforeEach(() => {
  online = true;
  server = new Map();
  useChatSendStore.getState().clear();
  sendMessage.mockReset().mockImplementation(idempotentServer());
  sendThreadMessage.mockReset();
  sendFileMessage.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("sending offline", () => {
  it("waits as queued, goes once online, and lands in the room exactly once", async () => {
    const qc = new QueryClient();
    const ids = shownTimeline(qc);
    online = false;
    await sendChatMessage(qc, input, deps);
    expect(statuses()).toEqual(["queued"]);
    expect(sendMessage).not.toHaveBeenCalled();

    online = true;
    await Promise.all([flushQueuedSends(qc, "w1", "u1", deps), flushQueuedSends(qc, "w1", "u1", deps)]);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual([]);
    expect(ids()).toHaveLength(1);
  });

  it("goes back to queued when the network drops mid-send, and a second post of the same key is one message", async () => {
    const qc = new QueryClient();
    const ids = shownTimeline(qc);
    // The server stored it, but the answer was lost on the way back.
    sendMessage.mockImplementationOnce(async (ws, room, body) => {
      await idempotentServer()(ws, room, body);
      throw new TypeError("Network request failed");
    });
    await sendChatMessage(qc, input, deps);
    expect(statuses()).toEqual(["queued"]);

    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(server.size).toBe(1);
    expect(sendMessage.mock.calls[0]?.[2].client_msg_id).toBe(sendMessage.mock.calls[1]?.[2].client_msg_id);
    expect(ids()).toHaveLength(1);
  });

  it("stops a flush when the network drops again, and only flushes this sender's workspace", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, input, deps);
    await sendChatMessage(qc, { ...input, workspaceId: "w2" }, deps);
    await sendChatMessage(qc, { ...input, senderId: "u9" }, deps);
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendMessage).not.toHaveBeenCalled();
    online = true;
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(["queued", "queued"]);
  });
});

describe("refusals and retries", () => {
  it("keeps a message the server refused for good as failed, until retried or discarded", async () => {
    const qc = new QueryClient();
    sendMessage.mockRejectedValueOnce(apiError(403));
    await sendChatMessage(qc, input, deps);
    expect(statuses()).toEqual(["failed"]);
    // A flush leaves a failed message alone.
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const [failed] = useChatSendStore.getState().entries;
    await deliverPendingSend(qc, failed!, deps);
    expect(statuses()).toEqual([]);

    sendMessage.mockRejectedValueOnce(apiError(422));
    await sendChatMessage(qc, input, deps);
    discardPendingSend(useChatSendStore.getState().entries[0]!.clientMsgId);
    expect(statuses()).toEqual([]);
  });

  it("does not post twice when a retry tap races a flush", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, input, deps);
    online = true;
    const [entry] = useChatSendStore.getState().entries;
    await Promise.all([deliverPendingSend(qc, entry!, deps), flushQueuedSends(qc, "w1", "u1", deps)]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // Two taps on "retry" share one delivery.
    online = false;
    await sendChatMessage(qc, input, deps);
    online = true;
    const [again] = useChatSendStore.getState().entries;
    const first = deliverPendingSend(qc, again!, deps);
    expect(deliverPendingSend(qc, again!, deps)).toBe(first);
    await first;
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("retries with the shared policy by default", async () => {
    const qc = new QueryClient();
    vi.useFakeTimers();
    sendMessage.mockRejectedValueOnce(apiError(503));
    const sent = sendChatMessage(qc, input, { ...deps, retry: undefined });
    await vi.advanceTimersByTimeAsync(400);
    await sent;
    vi.useRealTimers();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(statuses()).toEqual([]);
  });
});

describe("what goes where", () => {
  it("sends a thread reply to its thread and a file as multipart, with the reply target", async () => {
    const qc = new QueryClient();
    sendThreadMessage.mockResolvedValueOnce(echo("t", { thread_root_id: "root" }));
    sendFileMessage.mockResolvedValueOnce(echo("f", { kind: "file" }));
    await sendChatMessage(qc, { ...input, threadRootId: "root" }, deps);
    const file = { uri: "file:///a.png", name: "a.png", mimeType: "image/png" };
    await sendChatMessage(qc, { ...input, file, replyToMessageId: "m0" }, deps);
    expect(sendThreadMessage).toHaveBeenCalledWith("w1", "r1", "root", { body: "hi", client_msg_id: expect.any(String) });
    expect(sendFileMessage).toHaveBeenCalledWith("w1", "r1", { file, client_msg_id: expect.any(String), reply_to_message_id: "m0" });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("the app's wiring reads TanStack's online flag", () => {
    expect(chatSendDeps.isOnline()).toBe(true);
  });

  it("selects one room's sends for its timeline", () => {
    const entries = [
      { ...input, clientMsgId: "a", createdAt: 1, status: "queued" as const },
      { ...input, roomId: "r2", clientMsgId: "b", createdAt: 1, status: "queued" as const },
      { ...input, workspaceId: "w2", clientMsgId: "c", createdAt: 1, status: "queued" as const },
    ];
    expect(selectRoomSends(entries, "w1", "r1").map((e) => e.clientMsgId)).toEqual(["a"]);
  });
});
