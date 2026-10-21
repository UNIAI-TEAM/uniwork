// Spec §3 / §5 and audit R1–R3: a message sent offline shows as waiting, goes
// once the network is back, reaches the room once (client_msg_id) however
// many flushes or retries race for it, and a room's messages go strictly in
// the order they were written.
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));
// The outbox directory is native; deps.files stands in for it here (outbox-files.test.ts covers it).
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));

import { flattenRoomTimeline, type RoomTimeline } from "./chat-timeline";
import {
  chatSendDeps,
  clearChatOutbox,
  discardPendingSend,
  flushQueuedSends,
  retryPendingSend,
  sendChatMessage,
  type ChatSendDeps,
} from "./chat-send";
import type { OutboxFiles } from "./outbox-files";
import { chatKeys } from "./queries/chat-keys";
import type { RetryTimers } from "./retry-timers";
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
const sendVoiceMessage = vi.fn<ChatSendDeps["api"]["sendVoiceMessage"]>();
const files = {
  keep: vi.fn<OutboxFiles["keep"]>(),
  release: vi.fn<OutboxFiles["release"]>(),
  releaseAll: vi.fn<OutboxFiles["releaseAll"]>(),
};
/** The retry timer, fired by hand: `fire()` runs what is waiting. */
let waiting: (() => void) | null = null;
const timers = {
  schedule: vi.fn<RetryTimers["schedule"]>((_key, run) => {
    waiting ??= run;
  }),
  reset: vi.fn<RetryTimers["reset"]>(),
  cancelAll: vi.fn<RetryTimers["cancelAll"]>(),
};
const fire = () => {
  const run = waiting;
  waiting = null;
  run?.();
};
const deps: ChatSendDeps = {
  api: { sendMessage, sendThreadMessage, sendFileMessage, sendVoiceMessage },
  isOnline: () => online,
  retry: (fn) => fn(),
  files,
  timers,
};

/** The server's idempotency: one message per client_msg_id, whatever the number of posts. */
function idempotentServer() {
  return async (_ws: string, _room: string, input: { client_msg_id: string; body?: string }) => {
    if (!online) throw new TypeError("Network request failed");
    const existing = server.get(input.client_msg_id) ?? echo(input.client_msg_id, { body: input.body ?? "" });
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

/** Lets every pending delivery settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const input = { workspaceId: "w1", roomId: "r1", senderId: "u1", body: "hi" };
const statuses = () => useChatSendStore.getState().entries.map((entry) => entry.status);
const bodies = () => sendMessage.mock.calls.map((call) => call[2].body);

beforeEach(() => {
  online = true;
  server = new Map();
  waiting = null;
  useChatSendStore.getState().clear();
  sendMessage.mockReset().mockImplementation(idempotentServer());
  sendThreadMessage.mockReset();
  sendFileMessage.mockReset();
  sendVoiceMessage.mockReset();
  files.keep.mockReset().mockImplementation(async (id, file) => ({ ...file, uri: `file:///docs/outbox/${id}/${file.name}` }));
  files.release.mockReset();
  files.releaseAll.mockReset();
  timers.schedule.mockClear();
  timers.reset.mockClear();
  timers.cancelAll.mockClear();
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
    expect(timers.reset).toHaveBeenCalledWith("w1\nu1");
  });

  it("goes back to queued when the network drops mid-send, retries on the backoff, and a second post of the same key is one message", async () => {
    const qc = new QueryClient();
    const ids = shownTimeline(qc);
    // The server stored it, but the answer was lost on the way back.
    sendMessage.mockImplementationOnce(async (ws, room, body) => {
      await idempotentServer()(ws, room, body);
      throw new TypeError("Network request failed");
    });
    await sendChatMessage(qc, input, deps);
    expect(statuses()).toEqual(["queued"]);
    expect(timers.schedule).toHaveBeenCalledWith("w1\nu1", expect.any(Function));

    fire();
    await settle();
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

  it("drops off the network halfway through a room: the rest waits, in order", async () => {
    const qc = new QueryClient();
    online = false;
    for (const body of ["a", "b", "c"]) await sendChatMessage(qc, { ...input, body }, deps);
    online = true;
    sendMessage.mockImplementationOnce(async (ws, room, body) => {
      const sent = await idempotentServer()(ws, room, body);
      online = false;
      return sent;
    });
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(bodies()).toEqual(["a"]);
    online = true;
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(bodies()).toEqual(["a", "b", "c"]);
  });
});

describe("order (audit R2)", () => {
  it("sends one room's messages strictly in the order they were written, one at a time", async () => {
    const qc = new QueryClient();
    let release: () => void = () => undefined;
    sendMessage.mockImplementationOnce(async (ws, room, body) => {
      await new Promise<void>((resolve) => (release = resolve));
      return idempotentServer()(ws, room, body);
    });
    const first = sendChatMessage(qc, { ...input, body: "1" }, deps);
    await settle();
    const later = [sendChatMessage(qc, { ...input, body: "2" }, deps), sendChatMessage(qc, { ...input, body: "3" }, deps)];
    await settle();
    // "2" and "3" wait behind "1", which is still on the wire.
    expect(bodies()).toEqual(["1"]);
    release();
    await Promise.all([first, ...later]);
    expect(bodies()).toEqual(["1", "2", "3"]);
  });

  it("a transient failure holds the room's line until the retry; another room goes on", async () => {
    const qc = new QueryClient();
    sendMessage.mockRejectedValueOnce(apiError(503)).mockRejectedValueOnce(apiError(503));
    await sendChatMessage(qc, { ...input, body: "1" }, deps);
    // A new message nudges the line: "1" is tried again first, and "2" never jumps it.
    await sendChatMessage(qc, { ...input, body: "2" }, deps);
    await sendChatMessage(qc, { ...input, roomId: "r2", body: "elsewhere" }, deps);
    expect(bodies()).toEqual(["1", "1", "elsewhere"]);
    expect(statuses()).toEqual(["queued", "queued"]);
    // A burst of failures is one retry.
    expect(waiting).not.toBeNull();

    fire();
    await settle();
    expect(bodies()).toEqual(["1", "1", "elsewhere", "1", "2"]);
    expect(statuses()).toEqual([]);
  });

  it("a flush asked for while one runs looks at the queue once more after it", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, { ...input, body: "1" }, deps);
    online = true;
    let release: () => void = () => undefined;
    sendMessage.mockImplementationOnce(async (ws, room, body) => {
      await new Promise<void>((resolve) => (release = resolve));
      return idempotentServer()(ws, room, body);
    });
    const running = flushQueuedSends(qc, "w1", "u1", deps);
    await settle();
    // A message for another room lands while the flush is busy with r1.
    online = false;
    await sendChatMessage(qc, { ...input, roomId: "r2", body: "2" }, deps);
    online = true;
    expect(flushQueuedSends(qc, "w1", "u1", deps)).toBe(running);
    release();
    await running;
    expect(bodies()).toEqual(["1", "2"]);
  });
});

describe("refusals and retries", () => {
  it("keeps a message the server refused for good as failed, lets the room go on, until it is retried or discarded", async () => {
    const qc = new QueryClient();
    sendMessage.mockRejectedValueOnce(apiError(403));
    await sendChatMessage(qc, { ...input, body: "refused" }, deps);
    await sendChatMessage(qc, { ...input, body: "next" }, deps);
    expect(statuses()).toEqual(["failed"]);
    expect(bodies()).toEqual(["refused", "next"]);
    // A flush leaves a failed message alone.
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendMessage).toHaveBeenCalledTimes(2);

    const [failed] = useChatSendStore.getState().entries;
    await retryPendingSend(qc, failed!, deps);
    expect(statuses()).toEqual([]);

    sendMessage.mockRejectedValueOnce(apiError(422));
    await sendChatMessage(qc, input, deps);
    const id = useChatSendStore.getState().entries[0]!.clientMsgId;
    discardPendingSend(id, deps);
    expect(statuses()).toEqual([]);
    expect(files.release).toHaveBeenLastCalledWith(id);
  });

  it("does not post twice when a retry tap races a flush, and a retry of a waiting message keeps it waiting offline", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, input, deps);
    const [entry] = useChatSendStore.getState().entries;
    await retryPendingSend(qc, entry!, deps);
    expect(statuses()).toEqual(["queued"]);
    online = true;
    await Promise.all([retryPendingSend(qc, entry!, deps), flushQueuedSends(qc, "w1", "u1", deps)]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
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

  it("an answer without a message is still a post the server took: the room refetches", async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    sendMessage.mockResolvedValueOnce(null);
    await sendChatMessage(qc, input, deps);
    expect(statuses()).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.roomMessages("w1", "r1") });
  });
});

describe("what goes where", () => {
  it("sends a thread reply to its thread and a file as multipart from its outbox copy, which goes once the server has it", async () => {
    const qc = new QueryClient();
    sendThreadMessage.mockResolvedValueOnce(echo("t", { thread_root_id: "root" }));
    sendFileMessage.mockResolvedValueOnce(echo("f", { kind: "file" }));
    await sendChatMessage(qc, { ...input, threadRootId: "root" }, deps);
    const file = { uri: "file:///cache/a.png", name: "a.png", mimeType: "image/png" };
    await sendChatMessage(qc, { ...input, file, replyToMessageId: "m0" }, deps);
    expect(sendThreadMessage).toHaveBeenCalledWith("w1", "r1", "root", { body: "hi", client_msg_id: expect.any(String) });
    const sent = sendFileMessage.mock.calls[0]![2];
    expect(files.keep).toHaveBeenCalledWith(sent.client_msg_id, file);
    expect(sent).toEqual({ file: { ...file, uri: `file:///docs/outbox/${sent.client_msg_id}/a.png` }, client_msg_id: sent.client_msg_id, reply_to_message_id: "m0" });
    expect(files.release).toHaveBeenCalledWith(sent.client_msg_id);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("queues a voice clip with its copy and sends it inside the server's bounds; a reminder as the web sends it", async () => {
    const qc = new QueryClient();
    online = false;
    const clip = { uri: "file:///cache/rec.m4a", name: "voice.m4a", mimeType: "audio/mp4" };
    await sendChatMessage(qc, { ...input, body: "", file: clip, voiceDurationMs: 130_400.6, replyToMessageId: "m0" }, deps);
    await sendChatMessage(qc, { ...input, body: "", file: clip, voiceDurationMs: 0 }, deps);
    const reminder = { body: "Gửi báo giá", remindAt: "2026-10-18T02:00:00.000Z", repeat: "daily" as const };
    await sendChatMessage(qc, { ...input, body: "", reminder }, deps);
    expect(statuses()).toEqual(["queued", "queued", "queued"]);
    expect(useChatSendStore.getState().entries[0]?.file?.uri).toMatch(/^file:\/\/\/docs\/outbox\//);

    online = true;
    sendVoiceMessage.mockResolvedValue(echo("v", { kind: "voice" }));
    sendMessage.mockResolvedValueOnce(echo("rm", { kind: "reminder" }));
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendVoiceMessage.mock.calls.map((call) => call[2])).toEqual([
      { uri: expect.stringMatching(/outbox/), duration_ms: 120_000, client_msg_id: expect.any(String), reply_to_message_id: "m0" },
      { uri: expect.stringMatching(/outbox/), duration_ms: 1, client_msg_id: expect.any(String), reply_to_message_id: undefined },
    ]);
    expect(sendMessage).toHaveBeenCalledWith("w1", "r1", {
      client_msg_id: expect.any(String),
      reminder: { body: "Gửi báo giá", remind_at: "2026-10-18T02:00:00.000Z", repeat: "daily" },
    });
    expect(statuses()).toEqual([]);
  });

  it("a message discarded while its file is copied is neither kept nor sent", async () => {
    const qc = new QueryClient();
    files.keep.mockImplementationOnce(async (id, file) => {
      discardPendingSend(id, deps);
      return file;
    });
    await sendChatMessage(qc, { ...input, file: { uri: "file:///a", name: "a" } }, deps);
    expect(sendFileMessage).not.toHaveBeenCalled();
    expect(files.release).toHaveBeenCalledTimes(2);
    expect(statuses()).toEqual([]);
  });

  it("sign-out clears the queue, its files and its timers", async () => {
    online = false;
    await sendChatMessage(new QueryClient(), input, deps);
    clearChatOutbox(deps);
    expect(statuses()).toEqual([]);
    expect(timers.cancelAll).toHaveBeenCalledTimes(1);
    expect(files.releaseAll).toHaveBeenCalledTimes(1);
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
