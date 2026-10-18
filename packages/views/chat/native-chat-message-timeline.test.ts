import { describe, expect, it } from "vitest";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import type { ChatSendOutboxEntry } from "@uniwork/core/chat/send-outbox-store";
import { toChatMessage } from "./native-chat-message-mapping";
import {
  buildMainTimelineMessages,
  buildThreadViewMessages,
  countNewSince,
} from "./native-chat-message-timeline";

const rootRecord: ChatMessageRecord = {
  id: "root1",
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u2",
  sender_display_name: "Bình",
  body: "Kế hoạch Q4",
  kind: "text",
  created_at: "2026-09-05T07:00:00.000Z",
  pinned: false,
  mentioned_user_ids: [],
  reactions: {},
  reply_count: 0,
  thread_unread: false,
};

function queued(clientMsgId: string, threadRootId?: string): ChatSendOutboxEntry {
  return {
    workspaceId: "ws1",
    senderId: "u1",
    roomId: "room1",
    body: `queued ${clientMsgId}`,
    client_msg_id: clientMsgId,
    thread_root_id: threadRootId,
    queued_at: "2026-09-05T08:00:00.000Z",
  };
}

describe("queued thread replies", () => {
  it("keep queued thread replies out of the main timeline", () => {
    const messages = buildMainTimelineMessages({
      anchorMessages: null,
      latestRows: [rootRecord],
      pendingEntries: [],
      outboxEntries: [queued("c-main"), queued("c-thread", "root1")],
      currentUserId: "u1",
      threadsEnabled: true,
    });
    expect(messages.map((message) => message.clientMsgId ?? message.id)).toEqual([
      "root1",
      "c-main",
    ]);
  });

  it("show the open thread's queued replies after the root until the server echoes them", () => {
    const threadRoot = toChatMessage(rootRecord);
    const outboxEntries = [queued("c-mine", "root1"), queued("c-other", "root2"), queued("c-main")];
    const input = {
      allMessages: [threadRoot],
      threadRoot,
      pendingEntries: [],
      outboxEntries,
      currentUserId: "u1",
      threadsEnabled: true,
    };

    const queuedView = buildThreadViewMessages({ ...input, threadRows: [] });
    expect(queuedView.map((message) => message.clientMsgId ?? message.id)).toEqual([
      "root1",
      "c-mine",
    ]);
    expect(queuedView[1]?.deliveryStatus).toBe("queued");

    const echoed = buildThreadViewMessages({
      ...input,
      threadRows: [
        {
          ...rootRecord,
          id: "reply1",
          sender_id: "u1",
          body: "queued c-mine",
          thread_root_id: "root1",
          created_at: "2026-09-05T08:00:01.000Z",
          client_msg_id: "c-mine",
        },
      ],
    });
    expect(echoed.map((message) => message.id)).toEqual(["root1", "reply1"]);
  });
});

describe("countNewSince", () => {
  const at = (id: string, sender: string) => toChatMessage({ ...rootRecord, id, sender_id: sender });
  const messages = [at("a", "u2"), at("b", "u1"), at("c", "u2"), at("d", "u3")];

  it("counts others' messages after the one the reader left at", () => {
    expect(countNewSince(messages, "a", "u1")).toBe(2);
  });

  it("is zero when the reader left at the newest or the message is not loaded", () => {
    expect(countNewSince(messages, "d", "u1")).toBe(0);
    expect(countNewSince(messages, "gone", "u1")).toBe(0);
    expect(countNewSince(messages, null, "u1")).toBe(0);
  });
});
