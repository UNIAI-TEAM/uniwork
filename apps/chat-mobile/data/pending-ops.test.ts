// Audit P2 "Realtime": a read, a reaction and a poll vote made offline or lost
// to a dead spot reach the server once, in order, and as the person last
// wanted them; a replay never toggles twice.
import { QueryClient } from "@tanstack/react-query";
import type { ChatMessageRecord, ChatRoomRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));

import { flattenRoomTimeline, type RoomTimeline } from "@uniwork/core/chat/room-timeline-pages";
import { onRoomRead } from "./room-read-signal";
import { clearPendingOps, deleteMessage, editMessage, flushAllPendingOps, flushPendingOps, markRoomRead, pendingOpsDeps, toggleReaction, votePoll, type PendingOpsDeps } from "./pending-ops";
import { chatKeys } from "./queries/chat-keys";
import { installReportSink } from "./report";
import type { RetryTimers } from "./retry-timers";
import { usePendingOpsStore } from "./stores/pending-ops-store";

const settings = { deadline_at: null, pin_to_top: false, allow_multiple: false, allow_add_options: true, hide_results_until_vote: false, hide_voters: false };
const msg = (id: string, extra: Partial<ChatMessageRecord> = {}) =>
  ({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: "u2",
    kind: "text",
    body: "hi",
    created_at: "2026-10-17T10:00:00Z",
    reactions: {},
    my_reactions: [],
    mentioned_user_ids: [],
    ...extra,
  }) as unknown as ChatMessageRecord;
const pollMsg = (viewer: string[]) =>
  msg("p1", { kind: "poll", poll: { question: "?", options: [{ id: "a", label: "A", votes: viewer.includes("a") ? 1 : 0 }, { id: "b", label: "B", votes: viewer.includes("b") ? 1 : 0 }], settings, viewer_option_ids: viewer } } as Partial<ChatMessageRecord>);
const apiError = (status: number) => Object.assign(new Error(String(status)), { name: "ApiError", status });

let online = true;
let waiting: (() => void) | null = null;
const api = {
  markRoomRead: vi.fn<PendingOpsDeps["api"]["markRoomRead"]>(),
  toggleReaction: vi.fn<PendingOpsDeps["api"]["toggleReaction"]>(),
  votePoll: vi.fn<PendingOpsDeps["api"]["votePoll"]>(),
  getMessage: vi.fn<PendingOpsDeps["api"]["getMessage"]>(),
  editMessage: vi.fn<PendingOpsDeps["api"]["editMessage"]>(),
  deleteMessage: vi.fn<PendingOpsDeps["api"]["deleteMessage"]>(),
};
const timers = {
  schedule: vi.fn<RetryTimers["schedule"]>((_key, run) => {
    waiting ??= run;
  }),
  // A wish set aside wakes the line at its time: fired by hand too, with the clock moved past it.
  after: vi.fn<RetryTimers["after"]>((_key, _ms, run) => {
    waiting = run;
  }),
  reset: vi.fn<RetryTimers["reset"]>(),
  cancelAll: vi.fn<RetryTimers["cancelAll"]>(),
};
let clock = 1_000;
const deps: PendingOpsDeps = { api, isOnline: () => online, timers, now: () => clock, random: () => 0.5 };
const fire = async () => {
  clock += 2 * 60 * 60_000;
  const run = waiting;
  waiting = null;
  run?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const timelineKey = chatKeys.roomMessages("w1", "r1");
function seeded(messages: ChatMessageRecord[] = [msg("m1", { reactions: { "👍": 1 } })]): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<RoomTimeline>(timelineKey, { pages: [messages], pageParams: [null] });
  qc.setQueryData<ChatRoomRecord[]>(chatKeys.rooms("w1"), [
    { id: "r1", unread_count: 3, mention_unread_count: 1 } as ChatRoomRecord,
    { id: "r2", unread_count: 2, mention_unread_count: 0 } as ChatRoomRecord,
  ]);
  return qc;
}
const shown = (qc: QueryClient, id = "m1") => flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!).find((m) => m.id === id)!;
const ops = () => usePendingOpsStore.getState().ops;

beforeEach(() => {
  online = true;
  waiting = null;
  usePendingOpsStore.getState().clear();
  for (const fn of Object.values(api)) fn.mockReset();
  api.markRoomRead.mockResolvedValue(true);
  timers.schedule.mockClear();
  timers.after.mockClear();
  clock = 1_000;
  timers.reset.mockClear();
  timers.cancelAll.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe("reads", () => {
  it("clears the badge at once and tells the server; offline it waits and goes once online", async () => {
    const qc = seeded();
    const heard = vi.fn();
    const stop = onRoomRead(heard);
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    stop();
    expect(api.markRoomRead).toHaveBeenCalledWith("w1", "r1");
    expect(qc.getQueryData<ChatRoomRecord[]>(chatKeys.rooms("w1"))?.map((r) => r.unread_count)).toEqual([0, 2]);
    // The room's notifications come down with its badge (data/notification-tray.ts, wired at boot).
    expect(heard).toHaveBeenCalledWith("r1");
    expect(ops()).toEqual([]);
    // No rooms list loaded: nothing to clear, the server is still told.
    await markRoomRead(new QueryClient(), "w1", "r1", "u1", deps);
    expect(api.markRoomRead).toHaveBeenCalledTimes(2);

    online = false;
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    expect(ops().map((op) => [op.key, op.rev])).toEqual([["read/w1/r1", 2]]);
    online = true;
    api.markRoomRead.mockResolvedValueOnce(false);
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.markRoomRead).toHaveBeenCalledTimes(3);
    expect(ops()).toEqual([]);
    expect(timers.reset).toHaveBeenCalledWith("ops\nw1\nu1");
  });

  it("is not swallowed: a dead spot retries on the backoff, a refusal is reported and dropped", async () => {
    const qc = seeded();
    api.markRoomRead.mockRejectedValueOnce(new TypeError("Network request failed"));
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    expect(ops()).toHaveLength(1);
    expect(timers.schedule).toHaveBeenCalledWith("ops\nw1\nu1", expect.any(Function));
    await fire();
    expect(ops()).toEqual([]);

    const captured = vi.fn();
    installReportSink({ captureException: captured, addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() });
    try {
      api.markRoomRead.mockRejectedValueOnce(new Error("bug"));
      await markRoomRead(qc, "w1", "r1", "u1", deps);
      expect(ops()).toEqual([]);
      expect(captured).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: expect.objectContaining({ source: "pending-op", kind: "read" }) }));
    } finally {
      installReportSink(null);
    }
  });
});

describe("reactions", () => {
  it("shows at once and sends one toggle online", async () => {
    const qc = seeded();
    api.toggleReaction.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 2 }, my_reactions: ["👍"] }));
    const tap = toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    expect(shown(qc)).toMatchObject({ reactions: { "👍": 2 }, my_reactions: ["👍"] });
    await tap;
    expect(api.toggleReaction).toHaveBeenCalledExactlyOnceWith("w1", "r1", "m1", "👍");
    expect(api.getMessage).not.toHaveBeenCalled();
    expect(ops()).toEqual([]);
  });

  it("offline: tapped back to what the server has sends nothing; the last wish goes once online", async () => {
    const qc = seeded();
    online = false;
    await toggleReaction(qc, "w1", "r1", "m1", "❤️", "u1", deps);
    await toggleReaction(qc, "w1", "r1", "m1", "❤️", "u1", deps);
    expect(ops()).toEqual([]);
    expect(shown(qc).my_reactions).toEqual([]);
    await toggleReaction(qc, "w1", "r1", "m1", "❤️", "u1", deps);
    expect(shown(qc).reactions).toEqual({ "👍": 1, "❤️": 1 });
    online = true;
    api.toggleReaction.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 1, "❤️": 1 }, my_reactions: ["❤️"] }));
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.toggleReaction).toHaveBeenCalledTimes(1);
    expect(api.toggleReaction).not.toHaveBeenCalledTimes(2);
  });

  it("a lost answer is never toggled twice: the retry reads the message and finds it done", async () => {
    const qc = seeded();
    api.toggleReaction.mockRejectedValueOnce(apiError(503));
    await toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    expect(ops()[0]).toMatchObject({ verify: true, on: true });
    // The server did apply it.
    api.getMessage.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 2 }, my_reactions: ["👍"] }));
    await fire();
    expect(api.toggleReaction).toHaveBeenCalledTimes(1);
    expect(shown(qc).my_reactions).toEqual(["👍"]);
    expect(ops()).toEqual([]);

    // Not applied this time: the retry toggles.
    api.toggleReaction.mockRejectedValueOnce(apiError(0)).mockResolvedValueOnce(msg("m1", { my_reactions: [] }));
    await toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    api.getMessage.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 2 }, my_reactions: ["👍"] }));
    await fire();
    expect(api.toggleReaction).toHaveBeenCalledTimes(3);
    expect(ops()).toEqual([]);
  });

  // Review P2: the tap back dropped the queued wish although the 503 came after the server applied it.
  it("tapped back after a delivery that may have landed: the wish stays, is read and undone on the server", async () => {
    const qc = seeded();
    api.toggleReaction.mockRejectedValueOnce(apiError(503));
    await toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    expect(ops()[0]).toMatchObject({ verify: true, attempted: true, on: true });
    online = false;
    await toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    expect(shown(qc).my_reactions).toEqual([]);
    expect(ops()).toEqual([expect.objectContaining({ on: false, base: false, verify: true, attempted: true })]);
    online = true;
    // The first request did land: the server has the reaction, the screen does not.
    api.getMessage.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 2 }, my_reactions: ["👍"] }));
    api.toggleReaction.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 1 }, my_reactions: [] }));
    await fire();
    expect(api.toggleReaction).toHaveBeenCalledTimes(2);
    expect(shown(qc).my_reactions).toEqual([]);
    expect(ops()).toEqual([]);
  });

  it("a message gone or unreadable on the retry is not toggled blind: the room refetches", async () => {
    const qc = seeded();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    api.toggleReaction.mockRejectedValueOnce(new TypeError("offline"));
    await toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    api.getMessage.mockResolvedValueOnce(null);
    await fire();
    expect(api.toggleReaction).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: timelineKey });
    expect(ops()).toEqual([]);
  });

  it("a refusal for good drops it, restores the room from the server and tells the screen", async () => {
    const qc = seeded();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    api.toggleReaction.mockRejectedValueOnce(apiError(404));
    await expect(toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps)).rejects.toThrow("chat_pending_op_refused");
    expect(ops()).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: timelineKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.roomThreads("w1", "r1") });
  });

  it("a second tap while the first is on the wire goes next, read before it toggles", async () => {
    const qc = seeded();
    let answer: (m: ChatMessageRecord) => void = () => undefined;
    api.toggleReaction.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const first = toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    // The newer wish shows; the late answer of the first does not overwrite it.
    answer(msg("m1", { reactions: { "👍": 2 }, my_reactions: ["👍"] }));
    api.getMessage.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 2 }, my_reactions: ["👍"] }));
    api.toggleReaction.mockResolvedValueOnce(msg("m1", { reactions: { "👍": 1 }, my_reactions: [] }));
    await Promise.all([first, second]);
    expect(api.toggleReaction).toHaveBeenCalledTimes(2);
    expect(shown(qc).my_reactions).toEqual([]);
    expect(ops()).toEqual([]);
  });

  it("a reaction on a message not on screen is still queued", async () => {
    const qc = new QueryClient();
    api.toggleReaction.mockResolvedValueOnce(msg("zz", { my_reactions: ["👍"] }));
    await toggleReaction(qc, "w1", "r1", "zz", "👍", "u1", deps);
    expect(api.toggleReaction).toHaveBeenCalledWith("w1", "r1", "zz", "👍");
  });

  it("finds the message in a loaded thread too", async () => {
    const qc = new QueryClient();
    qc.setQueryData<RoomTimeline>(chatKeys.threadMessages("w1", "r1", "root"), { pages: [[msg("t1", { thread_root_id: "root" })]], pageParams: [null] });
    online = false;
    await toggleReaction(qc, "w1", "r1", "t1", "👍", "u1", deps);
    expect(ops()[0]).toMatchObject({ on: true, base: false });
  });
});

describe("poll votes", () => {
  it("shows the choice at once and brings the server to it, reading the poll first", async () => {
    const qc = seeded([pollMsg([])]);
    online = false;
    await votePoll(qc, "w1", "r1", "p1", "a", "u1", deps);
    await votePoll(qc, "w1", "r1", "p1", "b", "u1", deps);
    expect(shown(qc, "p1").poll?.viewer_option_ids).toEqual(["b"]);
    expect(ops()).toHaveLength(1);
    online = true;
    api.getMessage.mockResolvedValueOnce(pollMsg([]));
    api.votePoll.mockResolvedValueOnce(pollMsg(["b"]));
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.votePoll).toHaveBeenCalledExactlyOnceWith("w1", "r1", "p1", "b");
    expect(ops()).toEqual([]);
  });

  it("tapped back to the server's choice before anything went: nothing to send; a poll gone from the answer taps nothing", async () => {
    const qc = seeded([pollMsg(["a"])]);
    online = false;
    await votePoll(qc, "w1", "r1", "p1", "b", "u1", deps);
    await votePoll(qc, "w1", "r1", "p1", "a", "u1", deps);
    expect(ops()).toEqual([]);

    await votePoll(qc, "w1", "r1", "p1", "b", "u1", deps);
    online = true;
    api.getMessage.mockResolvedValueOnce(msg("p1"));
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.votePoll).not.toHaveBeenCalled();
    expect(ops()).toEqual([]);
  });

  it("tapped back after a delivery that may have landed: the poll is read and brought back", async () => {
    const qc = seeded([pollMsg([])]);
    api.getMessage.mockResolvedValueOnce(pollMsg([]));
    api.votePoll.mockRejectedValueOnce(new TypeError("Network request failed"));
    await votePoll(qc, "w1", "r1", "p1", "a", "u1", deps);
    expect(ops()[0]).toMatchObject({ attempted: true, optionIds: ["a"] });
    online = false;
    await votePoll(qc, "w1", "r1", "p1", "a", "u1", deps);
    expect(shown(qc, "p1").poll?.viewer_option_ids).toEqual([]);
    expect(ops()).toEqual([expect.objectContaining({ optionIds: [], base: [] })]);
    online = true;
    // The vote reached the server before the connection dropped.
    api.getMessage.mockResolvedValueOnce(pollMsg(["a"]));
    api.votePoll.mockResolvedValueOnce(pollMsg([]));
    await fire();
    expect(api.votePoll).toHaveBeenLastCalledWith("w1", "r1", "p1", "a");
    expect(api.votePoll).toHaveBeenCalledTimes(2);
    expect(ops()).toEqual([]);
  });

  it("a poll not on screen is voted on directly, as before", async () => {
    const qc = seeded();
    api.votePoll.mockResolvedValueOnce(pollMsg(["a"]));
    await votePoll(qc, "w1", "r1", "p1", "a", "u1", deps);
    expect(api.votePoll).toHaveBeenCalledWith("w1", "r1", "p1", "a");
    expect(api.getMessage).not.toHaveBeenCalled();
  });
});

// Audit "edit-delete-online-only": both waited for the server, failed offline, and showed nothing until it answered.
describe("edits", () => {
  it("show at once, wait offline, keep only the last edit and deliver it once as a PATCH of the whole body", async () => {
    const qc = seeded();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    online = false;
    await editMessage(qc, "w1", "r1", "m1", "một", "u1", deps);
    await editMessage(qc, "w1", "r1", "m1", "hai", "u1", deps);
    expect(shown(qc)).toMatchObject({ body: "hai", edited_at: expect.any(String) });
    expect(ops().map((op) => [op.key, op.rev])).toEqual([["edit/w1/m1", 2]]);
    expect(api.editMessage).not.toHaveBeenCalled();

    online = true;
    api.editMessage.mockResolvedValueOnce(msg("m1", { body: "hai", edited_at: "2026-10-22T10:00:00Z" }));
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.editMessage).toHaveBeenCalledTimes(1);
    expect(api.editMessage).toHaveBeenCalledWith("w1", "r1", "m1", "hai");
    expect(shown(qc).edited_at).toBe("2026-10-22T10:00:00Z");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("w1") });
    expect(ops()).toEqual([]);
  });

  it("a message not on screen is still edited; a dead spot retries; a message gone meanwhile is an edit done", async () => {
    const qc = new QueryClient();
    api.editMessage.mockRejectedValueOnce(new TypeError("Network request failed"));
    await editMessage(qc, "w1", "r1", "m9", "sửa", "u1", deps);
    expect(ops()).toHaveLength(1);
    api.editMessage.mockRejectedValueOnce(apiError(404));
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await fire();
    expect(ops()).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.roomMessages("w1", "r1") });
  });

  it("a refusal for good drops it, restores the room from the server and tells the screen", async () => {
    const qc = seeded();
    api.editMessage.mockRejectedValueOnce(apiError(403));
    await expect(editMessage(qc, "w1", "r1", "m1", "sửa", "u1", deps)).rejects.toThrow("chat_pending_op_refused");
    expect(ops()).toEqual([]);
  });

  it("an edit made while the last one is on the wire is not overwritten by the older answer", async () => {
    const qc = seeded();
    let answer: (record: ChatMessageRecord) => void = () => undefined;
    api.editMessage.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const first = editMessage(qc, "w1", "r1", "m1", "một", "u1", deps);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = editMessage(qc, "w1", "r1", "m1", "hai", "u1", deps);
    answer(msg("m1", { body: "một" }));
    api.editMessage.mockResolvedValueOnce(msg("m1", { body: "hai" }));
    await Promise.all([first, second]);
    expect(api.editMessage.mock.calls.map(([, , , body]) => body)).toEqual(["một", "hai"]);
    expect(shown(qc).body).toBe("hai");
  });
});

describe("deletes", () => {
  it("take the message off at once with every wish still queued for it, and go when the network is back", async () => {
    const qc = seeded([msg("m1"), msg("m2")]);
    online = false;
    await toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    await editMessage(qc, "w1", "r1", "m1", "sửa", "u1", deps);
    await toggleReaction(qc, "w1", "r1", "m2", "👍", "u1", deps);
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    await deleteMessage(qc, "w1", "r1", "m1", "u1", deps);
    expect(flattenRoomTimeline(qc.getQueryData<RoomTimeline>(timelineKey)!).map((m) => m.id)).toEqual(["m2"]);
    expect(ops().map((op) => op.key)).toEqual(["reaction/w1/m2/👍", "read/w1/r1", "delete/w1/m1"]);
    // A second tap (a double press) is still one delete.
    await deleteMessage(qc, "w1", "r1", "m1", "u1", deps);
    expect(ops().filter((op) => op.kind === "delete")).toHaveLength(1);

    online = true;
    api.deleteMessage.mockResolvedValueOnce(true);
    api.toggleReaction.mockResolvedValueOnce(msg("m2", { my_reactions: ["👍"] }));
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.deleteMessage).toHaveBeenCalledTimes(1);
    expect(api.editMessage).not.toHaveBeenCalled();
    expect(ops()).toEqual([]);
  });

  it("a message already gone is a delete done; one the server would not delete comes back and the screen is told", async () => {
    const qc = seeded([msg("m1"), msg("m2")]);
    api.deleteMessage.mockRejectedValueOnce(apiError(404));
    await deleteMessage(qc, "w1", "r1", "m1", "u1", deps);
    expect(ops()).toEqual([]);
    api.deleteMessage.mockResolvedValueOnce(false);
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    await expect(deleteMessage(qc, "w1", "r1", "m2", "u1", deps)).rejects.toThrow("chat_pending_op_refused");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.roomMessages("w1", "r1") });
  });
});

describe("the line", () => {
  it("delivers in the order the wishes were made and stops at a dead spot", async () => {
    const qc = seeded();
    online = false;
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    await toggleReaction(qc, "w1", "r1", "m1", "👍", "u1", deps);
    online = true;
    api.markRoomRead.mockRejectedValueOnce(new TypeError("Network request failed"));
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.toggleReaction).not.toHaveBeenCalled();
    api.toggleReaction.mockResolvedValueOnce(msg("m1", { my_reactions: ["👍"] }));
    await fire();
    expect(api.toggleReaction).toHaveBeenCalledTimes(1);
    expect(ops()).toEqual([]);
  });

  it("a wish the server fails on its own is set aside: the others go, it comes back on its own backoff, then it is given up", async () => {
    const qc = seeded([msg("m1"), msg("m2")]);
    online = false;
    await editMessage(qc, "w1", "r1", "m1", "poison", "u1", deps);
    await toggleReaction(qc, "w1", "r1", "m2", "👍", "u1", deps);
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    online = true;
    api.editMessage.mockRejectedValue(apiError(500));
    api.toggleReaction.mockResolvedValueOnce(msg("m2", { my_reactions: ["👍"], reactions: { "👍": 1 } }));
    await flushPendingOps(qc, "w1", "u1", deps);
    // The edit failed on its own: the reaction and the read behind it went anyway.
    expect(api.toggleReaction).toHaveBeenCalledTimes(1);
    expect(api.markRoomRead).toHaveBeenCalledTimes(1);
    expect(ops().map((op) => [op.key, op.failures, op.retryAt])).toEqual([["edit/w1/m1", 1, 6_000]]);
    expect(timers.after).toHaveBeenLastCalledWith("ops\nw1\nu1\nset-aside", 5_000, expect.any(Function));
    // The line's own backoff is untouched by it; the edit still shows meanwhile.
    expect(timers.schedule).not.toHaveBeenCalled();
    expect(shown(qc).body).toBe("poison");

    // Not due yet: a flush (a network edge, the app back in front) passes it by.
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.editMessage).toHaveBeenCalledTimes(1);
    const captured = vi.fn();
    installReportSink({ captureException: captured, addBreadcrumb: vi.fn(), setUser: vi.fn(), setTag: vi.fn() });
    try {
      for (let failure = 2; failure <= 8; failure += 1) {
        await fire();
        expect(api.editMessage).toHaveBeenCalledTimes(failure);
      }
      // Given up after its eighth failure: dropped, reported, and the room goes back to the server's state.
      expect(ops()).toEqual([]);
      expect(captured).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: expect.objectContaining({ kind: "edit", gave_up: "true" }) }));
      expect(qc.getQueryState(timelineKey)?.isInvalidated).toBe(true);
    } finally {
      installReportSink(null);
    }
  });

  it("shares one run per workspace and person, and offline it waits", async () => {
    const qc = seeded();
    online = false;
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    await flushPendingOps(qc, "w1", "u1", deps);
    expect(api.markRoomRead).not.toHaveBeenCalled();
    online = true;
    const run = flushPendingOps(qc, "w1", "u1", deps);
    expect(flushPendingOps(qc, "w1", "u1", deps)).toBe(run);
    await run;
    expect(api.markRoomRead).toHaveBeenCalledTimes(1);
  });

  it("flushes every workspace the person owes something in, whichever is open, and nobody else's", async () => {
    const qc = seeded();
    online = false;
    await markRoomRead(qc, "w1", "r1", "u1", deps);
    await markRoomRead(qc, "w2", "r9", "u1", deps);
    await markRoomRead(qc, "w3", "r9", "someone-else", deps);
    online = true;
    await flushAllPendingOps(qc, "u1", deps);
    expect(api.markRoomRead.mock.calls.map(([ws]) => ws).sort()).toEqual(["w1", "w2"]);
    expect(ops().map((op) => op.workspaceId)).toEqual(["w3"]);
  });

  it("sign-out drops the wishes and their timers; the app's wiring reads TanStack's online flag", async () => {
    online = false;
    await markRoomRead(seeded(), "w1", "r1", "u1", deps);
    clearPendingOps(deps);
    expect(ops()).toEqual([]);
    expect(timers.cancelAll).toHaveBeenCalledTimes(1);
    expect(pendingOpsDeps.isOnline()).toBe(true);
  });
});
