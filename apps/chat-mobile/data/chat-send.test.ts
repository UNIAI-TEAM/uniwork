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

import { flattenRoomTimeline, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import {
  FAILED_SEND_TTL_MS,
  MEDIA_OVERTAKE_MS,
  chatSendDeps,
  clearChatOutbox,
  discardPendingSend,
  flushAllQueuedSends,
  flushQueuedSends,
  observeChatSends,
  retryPendingSend,
  sendChatMessage,
  type ChatSendDeps,
} from "./chat-send";
import type { OutboxFiles } from "./outbox-files";
import { chatKeys } from "./queries/chat-keys";
import { createRetryTimers, type RetryTimers } from "./retry-timers";
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
  resolve: vi.fn<OutboxFiles["resolve"]>(),
};
/** The retry timer, fired by hand: `fire()` runs what is waiting. */
let waiting: (() => void) | null = null;
const timers = {
  schedule: vi.fn<RetryTimers["schedule"]>((_key, run) => {
    waiting ??= run;
  }),
  after: vi.fn<RetryTimers["after"]>(),
  reset: vi.fn<RetryTimers["reset"]>(),
  cancelAll: vi.fn<RetryTimers["cancelAll"]>(),
};
const fire = () => {
  const run = waiting;
  waiting = null;
  run?.();
};
let clock = 0;
/** The text line's wait behind an upload, ended by hand: `elapse()` moves the clock and ends every wait. */
let sleepers: (() => void)[] = [];
const sleep = vi.fn((_ms: number) => new Promise<void>((resolve) => sleepers.push(resolve)));
const elapse = (ms: number) => {
  clock += ms;
  const woken = sleepers;
  sleepers = [];
  for (const wake of woken) wake();
};
const deps: ChatSendDeps = {
  api: { sendMessage, sendThreadMessage, sendFileMessage, sendVoiceMessage },
  isOnline: () => online,
  retry: (fn) => fn(),
  files,
  timers,
  now: () => clock,
  sleep,
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
  clock = 0;
  sleepers = [];
  sleep.mockClear();
  useChatSendStore.getState().clear();
  sendMessage.mockReset().mockImplementation(idempotentServer());
  sendThreadMessage.mockReset();
  sendFileMessage.mockReset();
  sendVoiceMessage.mockReset();
  files.keep.mockReset().mockImplementation(async (id, file) => ({ ...file, uri: `file:///docs/outbox/${id}/${file.name}` }));
  files.release.mockReset();
  files.releaseAll.mockReset();
  files.resolve.mockReset().mockImplementation((_id, file) => file);
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
    expect(timers.reset).toHaveBeenCalledWith("w1\nr1\nu1\ntext");
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
    expect(timers.schedule).toHaveBeenCalledWith("w1\nr1\nu1\ntext", expect.any(Function));

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

  // Review P2: the upload of a purged file rejected as a TypeError, read as "no network", and the
  // room's later messages stayed queued behind it for ever.
  it("a message that keeps failing for its own reason fails after five rounds and lets the room go on; the network never counts", async () => {
    const qc = new QueryClient();
    const ended = vi.fn();
    const stop = observeChatSends(ended);
    sendMessage.mockImplementation(async (ws, room, body) => {
      if (body.body === "poison") throw apiError(500);
      return idempotentServer()(ws, room, body);
    });
    await sendChatMessage(qc, { ...input, body: "poison" }, deps);
    await sendChatMessage(qc, { ...input, body: "next" }, deps);
    const failures = () => useChatSendStore.getState().entries.map((entry) => [entry.status, entry.failures]);
    // The second message nudged the line: the first was tried again first.
    expect(failures()).toEqual([
      ["queued", 2],
      ["queued", undefined],
    ]);
    // A dead spot in between is the network's, not the message's.
    online = false;
    fire();
    await settle();
    online = true;
    sendMessage.mockRejectedValueOnce(new TypeError("Network request failed"));
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(failures()[0]).toEqual(["queued", 2]);
    for (let round = 3; round <= 4; round += 1) {
      fire();
      await settle();
    }
    expect(failures()[0]).toEqual(["queued", 4]);
    expect(bodies()).not.toContain("next");
    fire();
    await settle();
    // The fifth round: failed, with "Thử lại", and the message behind it went.
    expect(statuses()).toEqual(["failed"]);
    expect(bodies().filter((body) => body === "poison")).toHaveLength(6);
    expect(bodies().at(-1)).toBe("next");
    expect(ended).toHaveBeenCalledWith("failed", expect.any(Number));
    stop();

    // The person's retry starts the count again; a throw that is no HTTP answer counts too.
    sendMessage.mockReset().mockRejectedValueOnce(new Error("bug")).mockImplementation(idempotentServer());
    await retryPendingSend(qc, useChatSendStore.getState().entries[0]!, deps);
    expect(failures()).toEqual([["queued", 1]]);
    fire();
    await settle();
    expect(statuses()).toEqual([]);
  });

  it("a queued file that is gone fails for good, without an upload, and the room's next message goes", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, { ...input, body: "", file: { uri: "file:///cache/gone.png", name: "gone.png" } }, deps);
    await sendChatMessage(qc, { ...input, body: "after" }, deps);
    files.resolve.mockReturnValueOnce(null);
    online = true;
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendFileMessage).not.toHaveBeenCalled();
    expect(bodies()).toEqual(["after"]);
    expect(statuses()).toEqual(["failed"]);
    expect(timers.schedule).not.toHaveBeenCalled();
  });

  it("uploads a file from where the outbox copy is now, not the path stored before an update moved it", async () => {
    const qc = new QueryClient();
    files.resolve.mockImplementationOnce((id, file) => ({ ...file, uri: `file:///new-container/outbox/${id}/${file.name}` }));
    sendFileMessage.mockResolvedValueOnce(echo("f", { kind: "file" }));
    await sendChatMessage(qc, { ...input, file: { uri: "file:///cache/a.png", name: "a.png" } }, deps);
    const sent = sendFileMessage.mock.calls[0]![2];
    expect(files.resolve).toHaveBeenCalledWith(sent.client_msg_id, { uri: `file:///docs/outbox/${sent.client_msg_id}/a.png`, name: "a.png" });
    expect(sent.file.uri).toBe(`file:///new-container/outbox/${sent.client_msg_id}/a.png`);
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

// Audit "no-product-analytics": the product counters hear how each send ended (data/analytics.ts).
describe("observeChatSends", () => {
  it("hears a delivered send with its time since it was written, a refusal for good, and nothing for a transient failure", async () => {
    const heard: [string, number][] = [];
    const stop = observeChatSends((outcome, ms) => heard.push([outcome, ms]));
    const qc = new QueryClient();
    const wall = vi.spyOn(Date, "now").mockReturnValue(1_000);
    online = false;
    await sendChatMessage(qc, { ...input, body: "later" }, deps);
    expect(heard).toEqual([]);
    wall.mockReturnValue(4_000);
    online = true;
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(heard).toEqual([["sent", 3_000]]);
    sendMessage.mockRejectedValueOnce(apiError(403));
    await sendChatMessage(qc, { ...input, body: "refused" }, deps);
    expect(heard.at(-1)).toEqual(["failed", 0]);
    online = false;
    await sendChatMessage(qc, { ...input, roomId: "r2", body: "", file: { uri: "file:///cache/gone.png", name: "gone.png" } }, deps);
    files.resolve.mockReturnValueOnce(null);
    online = true;
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(heard.filter(([outcome]) => outcome === "failed")).toHaveLength(2);
    wall.mockRestore();
    stop();
    await sendChatMessage(qc, { ...input, body: "unheard" }, deps);
    expect(heard).toHaveLength(3);
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

  it("selects one room's sends of the signed-in person for its timeline", () => {
    const entries = [
      { ...input, clientMsgId: "a", createdAt: 1, status: "queued" as const },
      { ...input, roomId: "r2", clientMsgId: "b", createdAt: 1, status: "queued" as const },
      { ...input, workspaceId: "w2", clientMsgId: "c", createdAt: 1, status: "queued" as const },
      // Another account's unsent message is never shown, nor offered for retry, as this person's.
      { ...input, senderId: "someone-else", clientMsgId: "d", createdAt: 1, status: "failed" as const },
    ];
    expect(selectRoomSends(entries, "w1", "r1", input.senderId).map((e) => e.clientMsgId)).toEqual(["a"]);
  });
});

// Audit "outbox-foreground-and-workspace-bound": a large upload held every word of its room behind it.
describe("text and media lines", () => {
  const photo = { uri: "file:///cache/big.jpg", name: "big.jpg", mimeType: "image/jpeg" };
  /** An upload that lands when `land()` is called. */
  function slowUpload() {
    let land: () => void = () => undefined;
    sendFileMessage.mockImplementationOnce(async (_ws, _room, { client_msg_id }) => {
      await new Promise<void>((resolve) => (land = resolve));
      return echo(client_msg_id, { kind: "file" });
    });
    return () => land();
  }

  it("text written after a photo waits for a quick upload: the room reads as it was written", async () => {
    const qc = new QueryClient();
    const land = slowUpload();
    const sent = sendChatMessage(qc, { ...input, body: "", file: photo }, deps);
    await settle();
    const after = sendChatMessage(qc, { ...input, body: "see above" }, deps);
    await settle();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(MEDIA_OVERTAKE_MS);
    elapse(1_000);
    await settle();
    // A second look: still within the window, it waits what is left.
    expect(sleep).toHaveBeenLastCalledWith(MEDIA_OVERTAKE_MS - 1_000);
    land();
    await Promise.all([sent, after]);
    expect(bodies()).toEqual(["see above"]);
    expect(statuses()).toEqual([]);
  });

  it("text passes an upload that has been on the wire long enough; the photo lands when it lands", async () => {
    const qc = new QueryClient();
    const land = slowUpload();
    const sent = sendChatMessage(qc, { ...input, body: "", file: photo }, deps);
    await settle();
    const after = sendChatMessage(qc, { ...input, body: "words first" }, deps);
    await settle();
    elapse(MEDIA_OVERTAKE_MS);
    await after;
    expect(bodies()).toEqual(["words first"]);
    expect(statuses()).toEqual(["sending"]);
    land();
    await sent;
    expect(statuses()).toEqual([]);
  });

  it("text passes a photo waiting for its retry, and a photo not yet on the wire is started before it is weighed", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, { ...input, body: "", file: photo }, deps);
    await sendChatMessage(qc, { ...input, body: "", file: { ...photo, name: "second.jpg" } }, deps);
    await sendChatMessage(qc, { ...input, body: "after the photos" }, deps);
    expect(sendFileMessage).not.toHaveBeenCalled();
    online = true;
    sendFileMessage.mockRejectedValueOnce(apiError(503));
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(sendFileMessage).toHaveBeenCalledTimes(1);
    expect(bodies()).toEqual(["after the photos"]);
    expect(statuses()).toEqual(["queued", "queued"]);

    // The retry runs the media line again: the photos go, in order.
    sendFileMessage.mockImplementation(async (_ws, _room, { client_msg_id }) => echo(client_msg_id, { kind: "file" }));
    fire();
    await settle();
    expect(sendFileMessage.mock.calls.map(([, , { file }]) => file.name)).toEqual(["big.jpg", "big.jpg", "second.jpg"]);
    expect(statuses()).toEqual([]);
  });

  it("a text that goes while the photo waits for its retry does not cancel that retry (real timers)", async () => {
    vi.useFakeTimers();
    try {
      const qc = new QueryClient();
      const real: ChatSendDeps = { ...deps, timers: createRetryTimers(() => 0.5) };
      sendFileMessage.mockRejectedValueOnce(apiError(503)).mockImplementation(async (_ws, _room, { client_msg_id }) => echo(client_msg_id, { kind: "file" }));
      await sendChatMessage(qc, { ...input, body: "", file: photo }, real);
      expect(statuses()).toEqual(["queued"]);
      // The photo waits for its backoff, so the words written after it go now.
      await sendChatMessage(qc, { ...input, body: "after" }, real);
      expect(bodies()).toEqual(["after"]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(sendFileMessage).toHaveBeenCalledTimes(2);
      expect(statuses()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("each line backs off on its own: a failing room does not stretch another room's wait", async () => {
    vi.useFakeTimers();
    try {
      const qc = new QueryClient();
      const real: ChatSendDeps = { ...deps, timers: createRetryTimers(() => 0.5) };
      sendMessage.mockRejectedValueOnce(apiError(503)).mockRejectedValueOnce(apiError(503)).mockRejectedValueOnce(apiError(503));
      await sendChatMessage(qc, { ...input, body: "a" }, real);
      // r1 retries after 2 s and fails again: its next wait is 5 s.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(bodies()).toEqual(["a", "a"]);
      // r2's first failure still waits the shortest delay.
      await sendChatMessage(qc, { ...input, roomId: "r2", body: "b" }, real);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(bodies()).toEqual(["a", "a", "b", "b"]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(bodies()).toEqual(["a", "a", "b", "b", "a"]);
      expect(statuses()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a photo queued offline is started by the text written after it, which then waits for it", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, { ...input, body: "", file: photo }, deps);
    online = true;
    sendFileMessage.mockImplementationOnce(async (_ws, _room, { client_msg_id }) => echo(client_msg_id, { kind: "file" }));
    // No flush ran since the network came back: the new message's line starts the photo's.
    await sendChatMessage(qc, { ...input, body: "now" }, deps);
    expect(sleep).toHaveBeenCalledWith(MEDIA_OVERTAKE_MS);
    expect(sendFileMessage).toHaveBeenCalledTimes(1);
    expect(bodies()).toEqual(["now"]);
    expect(statuses()).toEqual([]);
  });

  it("a text line that finds the network gone while it waits stops, and goes on the next flush", async () => {
    const qc = new QueryClient();
    const land = slowUpload();
    const sent = sendChatMessage(qc, { ...input, body: "", file: photo }, deps);
    await settle();
    const after = sendChatMessage(qc, { ...input, body: "later" }, deps);
    await settle();
    online = false;
    land();
    await Promise.all([sent, after]);
    expect(bodies()).toEqual([]);
    online = true;
    await flushQueuedSends(qc, "w1", "u1", deps);
    expect(bodies()).toEqual(["later"]);
  });

  it("waits on the real clock by default", async () => {
    vi.useFakeTimers();
    try {
      const qc = new QueryClient();
      const land = slowUpload();
      const real: ChatSendDeps = { ...deps, now: undefined, sleep: undefined };
      const sent = sendChatMessage(qc, { ...input, body: "", file: photo }, real);
      await vi.advanceTimersByTimeAsync(0);
      const after = sendChatMessage(qc, { ...input, body: "on time" }, real);
      await vi.advanceTimersByTimeAsync(MEDIA_OVERTAKE_MS);
      await after;
      expect(bodies()).toEqual(["on time"]);
      land();
      await sent;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("every workspace", () => {
  it("flushes the sender's messages of every workspace, whichever is open, and nobody else's", async () => {
    const qc = new QueryClient();
    online = false;
    await sendChatMessage(qc, { ...input, body: "w1" }, deps);
    await sendChatMessage(qc, { ...input, workspaceId: "w2", body: "w2" }, deps);
    await sendChatMessage(qc, { ...input, senderId: "u9", body: "not mine" }, deps);
    online = true;
    await flushAllQueuedSends(qc, "u1", deps);
    expect(bodies().sort()).toEqual(["w1", "w2"]);
    expect(statuses()).toEqual(["queued"]);
  });

  it("drops a refusal nobody retried for two weeks, with its file; a newer one stays for the person to see", async () => {
    const qc = new QueryClient();
    sendMessage.mockRejectedValueOnce(apiError(403)).mockRejectedValueOnce(apiError(403));
    clock = 0;
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    await sendChatMessage(qc, { ...input, body: "old" }, deps);
    vi.spyOn(Date, "now").mockReturnValue(FAILED_SEND_TTL_MS);
    await sendChatMessage(qc, { ...input, roomId: "r2", body: "new" }, deps);
    const [old] = useChatSendStore.getState().entries;
    clock = FAILED_SEND_TTL_MS + 1_001;
    await flushAllQueuedSends(qc, "u1", deps);
    expect(useChatSendStore.getState().entries.map((e) => e.body)).toEqual(["new"]);
    expect(files.release).toHaveBeenCalledWith(old!.clientMsgId);
    // The app's own clock by default.
    await flushAllQueuedSends(qc, "u1", { ...deps, now: undefined });
    expect(statuses()).toEqual(["failed"]);
  });
});
