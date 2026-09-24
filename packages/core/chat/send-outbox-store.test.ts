// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setCurrentWorkspace } from "../platform/workspace-storage";
import {
  CHAT_SEND_OUTBOX_STORAGE_KEY,
  CHAT_SEND_OUTBOX_TTL_MS,
  type ChatSendOutboxEntry,
  resetChatSendOutboxForTests,
  useChatSendOutboxStore,
} from "./send-outbox-store";

const NOW = Date.parse("2026-09-16T12:00:00Z");

function entry(overrides: Partial<ChatSendOutboxEntry> = {}): ChatSendOutboxEntry {
  return {
    workspaceId: "ws1",
    senderId: "u1",
    roomId: "room1",
    body: "hello",
    client_msg_id: "cmid-1",
    queued_at: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

const flush = async () => {
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
  await new Promise((resolve) => queueMicrotask(() => resolve(null)));
};

afterEach(async () => {
  resetChatSendOutboxForTests();
  setCurrentWorkspace(null, null);
  await flush();
  localStorage.clear();
});

describe("useChatSendOutboxStore", () => {
  it("dedupes entries by client_msg_id", () => {
    resetChatSendOutboxForTests();
    const { enqueue, listForWorkspace } = useChatSendOutboxStore.getState();
    enqueue(entry());
    enqueue(entry());
    expect(listForWorkspace("ws1", "u1", NOW)).toHaveLength(1);
  });

  it("lists and counts only the current sender's entries", () => {
    resetChatSendOutboxForTests();
    const { enqueue } = useChatSendOutboxStore.getState();
    enqueue(entry({ client_msg_id: "a1", senderId: "u1" }));
    enqueue(entry({ client_msg_id: "b1", senderId: "u2" }));

    const state = useChatSendOutboxStore.getState();
    expect(state.listForWorkspace("ws1", "u1", NOW).map((e) => e.client_msg_id)).toEqual(["a1"]);
    expect(state.listForWorkspace("ws1", "u2", NOW).map((e) => e.client_msg_id)).toEqual(["b1"]);
    expect(state.countForWorkspace("ws1", "u1", NOW)).toBe(1);
    expect(state.listForWorkspace("ws1", "", NOW)).toEqual([]);
  });

  it("ignores entries older than the TTL and prunes them", () => {
    resetChatSendOutboxForTests();
    const { enqueue } = useChatSendOutboxStore.getState();
    enqueue(entry({ client_msg_id: "fresh" }));
    enqueue(
      entry({
        client_msg_id: "stale",
        queued_at: new Date(NOW - CHAT_SEND_OUTBOX_TTL_MS - 1).toISOString(),
      }),
    );

    expect(
      useChatSendOutboxStore.getState().listForWorkspace("ws1", "u1", NOW).map((e) => e.client_msg_id),
    ).toEqual(["fresh"]);
    expect(useChatSendOutboxStore.getState().countForWorkspace("ws1", "u1", NOW)).toBe(1);

    useChatSendOutboxStore.getState().pruneStale(NOW);
    expect(useChatSendOutboxStore.getState().entries.map((e) => e.client_msg_id)).toEqual(["fresh"]);
  });

  it("drops legacy entries without a sender when rehydrating", async () => {
    const fresh = new Date().toISOString();
    localStorage.setItem(
      `${CHAT_SEND_OUTBOX_STORAGE_KEY}:acme/team`,
      JSON.stringify({
        state: {
          entries: [
            { workspaceId: "ws1", roomId: "room1", body: "legacy", client_msg_id: "legacy", queued_at: fresh },
            { ...entry({ client_msg_id: "owned" }), queued_at: fresh },
            {
              ...entry({ client_msg_id: "expired" }),
              queued_at: new Date(Date.now() - CHAT_SEND_OUTBOX_TTL_MS - 60_000).toISOString(),
            },
          ],
        },
        version: 0,
      }),
    );
    setCurrentWorkspace("acme/team", "ws1");
    await flush();
    await useChatSendOutboxStore.persist.rehydrate();

    expect(useChatSendOutboxStore.getState().entries.map((e) => e.client_msg_id)).toEqual(["owned"]);
  });
});
