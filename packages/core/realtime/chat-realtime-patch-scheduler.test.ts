import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatKeys } from "../chat/hooks";
import {
  fetchAndPatchChatMessage,
  patchChatMessageDeleted,
  patchChatMentionCreated,
} from "../chat/realtime-cache";
import { createChatRealtimePatchScheduler } from "./chat-realtime-patch-scheduler";

/** Debounce plus the largest jitter. */
const FLUSH_MAX_MS = 500;
/** Sidebar reload floor. */
const ROOMS_REFRESH_MIN_MS = 5_000;
/** Sidebar reload floor plus its largest jitter. */
const ROOMS_HOLD_MAX_MS = ROOMS_REFRESH_MIN_MS + 2_000;

vi.mock("../chat/realtime-cache", () => ({
  fetchAndPatchChatMessage: vi.fn(),
  patchChatMessageDeleted: vi.fn(),
  patchChatMentionCreated: vi.fn(),
  patchChatMessageLinked: vi.fn(),
  patchChatThreadLinked: vi.fn(),
}));

describe("createChatRealtimePatchScheduler", () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    qc = new QueryClient();
    // reset, not clear: a test's slow GET implementation must not leak into the next one.
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("flushes upserts via fetchAndPatchChatMessage", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(fetchAndPatchChatMessage).toHaveBeenCalledWith(qc, "ws1", "room1", "m1", false, undefined);
    await scheduler.dispose();
  });

  it("passes on whether the message was created and who sent it, even when a later frame updates it", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1", true, "u2");
    scheduler.scheduleUpsert("room1", "m1");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(fetchAndPatchChatMessage).toHaveBeenCalledTimes(1);
    expect(fetchAndPatchChatMessage).toHaveBeenCalledWith(qc, "ws1", "room1", "m1", true, "u2");
    await scheduler.dispose();
  });

  it("one failed GET keeps the rest of the batch and the sidebar refresh", async () => {
    vi.mocked(fetchAndPatchChatMessage).mockImplementation(async (_qc, _ws, _room, id) => {
      if (id === "gone") throw new Error("404");
    });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "gone");
    scheduler.scheduleUpsert("room1", "m2");
    scheduler.scheduleRoomActivity();
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(fetchAndPatchChatMessage).toHaveBeenCalledWith(qc, "ws1", "room1", "m2", false, undefined);
    expect(invalidate).toHaveBeenCalled();
    await scheduler.dispose();
  });

  it("spreads the flush with jitter so every client does not fetch at once", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1");
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchAndPatchChatMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS - 300);
    expect(fetchAndPatchChatMessage).toHaveBeenCalled();
    await scheduler.dispose();
  });

  it("a delete cancels the pending upsert for the same message", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1");
    scheduler.scheduleDelete("room1", "m1");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(fetchAndPatchChatMessage).not.toHaveBeenCalled();
    expect(patchChatMessageDeleted).toHaveBeenCalledWith(qc, "ws1", "room1", "m1");
    await scheduler.dispose();
  });

  it("an upsert cancels the pending delete for the same message", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleDelete("room1", "m1");
    scheduler.scheduleUpsert("room1", "m1");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(patchChatMessageDeleted).not.toHaveBeenCalled();
    expect(fetchAndPatchChatMessage).toHaveBeenCalledWith(qc, "ws1", "room1", "m1", false, undefined);
    await scheduler.dispose();
  });

  it("flushes mentions via patchChatMentionCreated", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleMention("room1", "u2");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(patchChatMentionCreated).toHaveBeenCalledWith(qc, "ws1", "room1", "u2");
    await scheduler.dispose();
  });

  it("scheduleRoomActivity invalidates rooms after the debounce flush", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    scheduler.scheduleRoomActivity();
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("ws1") }, { cancelRefetch: false });
    await scheduler.dispose();
  });

  it("runs room activity invalidate after upserts in the same flush", async () => {
    const order: string[] = [];
    vi.mocked(fetchAndPatchChatMessage).mockImplementation(async () => {
      order.push("upsert");
    });
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockImplementation(() => {
      order.push("invalidate");
      return Promise.resolve();
    });
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1");
    scheduler.scheduleRoomActivity();
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(order).toEqual(["upsert", "invalidate"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("ws1") }, { cancelRefetch: false });
    await scheduler.dispose();
  });

  it("reloads the sidebar at most once per ROOMS_REFRESH_MIN_MS and once more after the burst", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const roomsKey = JSON.stringify(chatKeys.rooms("ws1"));
    const roomsCalls = () =>
      invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === roomsKey).length;
    for (let i = 0; i < 20; i++) {
      scheduler.scheduleRoomActivity();
      await vi.advanceTimersByTimeAsync(200);
    }
    // 4 s of frames, one reload so far.
    expect(roomsCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(roomsCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(ROOMS_HOLD_MAX_MS + FLUSH_MAX_MS);
    expect(roomsCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(4 * ROOMS_HOLD_MAX_MS);
    expect(roomsCalls()).toBe(2);
    await scheduler.dispose();
  });

  it("keeps the sidebar floor while a flush waits on its message GETs", async () => {
    vi.mocked(fetchAndPatchChatMessage).mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 300)),
    );
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const roomsKey = JSON.stringify(chatKeys.rooms("ws1"));
    const runMs = 60_000;
    // 10 msg/s in a room whose timeline is loaded: an upsert and an activity frame each.
    for (let i = 0; i < runMs / 100; i++) {
      scheduler.scheduleUpsert("room1", `m${i}`, true, "u2");
      scheduler.scheduleRoomActivity();
      await vi.advanceTimersByTimeAsync(100);
    }
    const roomsCalls = invalidate.mock.calls.filter(
      ([filters]) => JSON.stringify(filters?.queryKey) === roomsKey,
    ).length;
    expect(roomsCalls).toBeLessThanOrEqual(runMs / ROOMS_REFRESH_MIN_MS);
    const disposed = scheduler.dispose();
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    await disposed;
  });

  it("a held sidebar reload does not hold back message upserts", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleRoomActivity();
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    scheduler.scheduleRoomActivity(); // held for the sidebar floor
    scheduler.scheduleUpsert("room1", "m1");
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    expect(fetchAndPatchChatMessage).toHaveBeenCalledWith(qc, "ws1", "room1", "m1", false, undefined);
    await scheduler.dispose();
  });

  it("scheduleMessageLinked invalidates without waiting for debounce", async () => {
    const { patchChatMessageLinked } = await import("../chat/realtime-cache");
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleMessageLinked("room1", "m1");
    expect(patchChatMessageLinked).toHaveBeenCalledWith(qc, "ws1", "room1", "m1");
    await scheduler.dispose();
  });

  it("dispose clears pending work without flushing", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    // A first reload, so the next one is held: dispose must cancel the held timer too.
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    scheduler.scheduleRoomActivity();
    await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
    vi.clearAllMocks();
    scheduler.scheduleUpsert("room1", "m1");
    scheduler.scheduleDelete("room1", "m2");
    scheduler.scheduleMention("room1", "u2");
    scheduler.scheduleRoomActivity();
    await scheduler.dispose();
    await vi.advanceTimersByTimeAsync(2 * ROOMS_HOLD_MAX_MS);
    expect(invalidate).not.toHaveBeenCalled();
    expect(fetchAndPatchChatMessage).not.toHaveBeenCalled();
    expect(patchChatMessageDeleted).not.toHaveBeenCalled();
    expect(patchChatMentionCreated).not.toHaveBeenCalled();
  });
});
