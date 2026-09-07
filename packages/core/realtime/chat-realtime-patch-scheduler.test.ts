import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatKeys } from "../chat/hooks";
import {
  fetchAndPatchChatMessage,
  patchChatMessageDeleted,
  patchChatMentionCreated,
} from "../chat/realtime-cache";
import { createChatRealtimePatchScheduler } from "./chat-realtime-patch-scheduler";

vi.mock("../chat/realtime-cache", () => ({
  fetchAndPatchChatMessage: vi.fn(),
  patchChatMessageDeleted: vi.fn(),
  patchChatMentionCreated: vi.fn(),
}));

describe("createChatRealtimePatchScheduler", () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    qc = new QueryClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes upserts via fetchAndPatchChatMessage", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1");
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchAndPatchChatMessage).toHaveBeenCalledWith(qc, "ws1", "room1", "m1");
    await scheduler.dispose();
  });

  it("a delete cancels the pending upsert for the same message", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1");
    scheduler.scheduleDelete("room1", "m1");
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchAndPatchChatMessage).not.toHaveBeenCalled();
    expect(patchChatMessageDeleted).toHaveBeenCalledWith(qc, "ws1", "room1", "m1");
    await scheduler.dispose();
  });

  it("an upsert cancels the pending delete for the same message", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleDelete("room1", "m1");
    scheduler.scheduleUpsert("room1", "m1");
    await vi.advanceTimersByTimeAsync(250);
    expect(patchChatMessageDeleted).not.toHaveBeenCalled();
    expect(fetchAndPatchChatMessage).toHaveBeenCalledWith(qc, "ws1", "room1", "m1");
    await scheduler.dispose();
  });

  it("flushes mentions via patchChatMentionCreated", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleMention("room1", "u2");
    await vi.advanceTimersByTimeAsync(250);
    expect(patchChatMentionCreated).toHaveBeenCalledWith(qc, "ws1", "room1", "u2");
    await scheduler.dispose();
  });

  it("scheduleRoomActivity invalidates the rooms query", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    scheduler.scheduleRoomActivity();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: chatKeys.rooms("ws1") });
    await scheduler.dispose();
  });

  it("dispose clears pending work without flushing", async () => {
    const scheduler = createChatRealtimePatchScheduler(qc, "ws1");
    scheduler.scheduleUpsert("room1", "m1");
    scheduler.scheduleDelete("room1", "m2");
    scheduler.scheduleMention("room1", "u2");
    await scheduler.dispose();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchAndPatchChatMessage).not.toHaveBeenCalled();
    expect(patchChatMessageDeleted).not.toHaveBeenCalled();
    expect(patchChatMentionCreated).not.toHaveBeenCalled();
  });
});
