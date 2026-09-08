import { describe, expect, it } from "vitest";
import {
  resetChatSendOutboxForTests,
  useChatSendOutboxStore,
} from "./send-outbox-store";

describe("useChatSendOutboxStore", () => {
  it("dedupes entries by client_msg_id", () => {
    resetChatSendOutboxForTests();
    const { enqueue, listForWorkspace } = useChatSendOutboxStore.getState();
    const entry = {
      workspaceId: "ws1",
      roomId: "room1",
      body: "hello",
      client_msg_id: "cmid-1",
      queued_at: "2026-09-05T00:00:00Z",
    };
    enqueue(entry);
    enqueue(entry);
    expect(listForWorkspace("ws1")).toHaveLength(1);
  });
});
