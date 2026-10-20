// Parity: the cases of packages/views/chat/chat-message-time.test.ts and
// native-chat-message-timeline.test.ts (queued entries are PendingSend here),
// plus the grouping rule of native-chat-message-grouping.ts.
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import type { PendingSend } from "./send-pipeline";
import {
  buildMainTimelineMessages,
  buildThreadViewMessages,
  buildTimelineRows,
  formatMessageDateTime,
  formatMessageDay,
  formatMessageTime,
  messageDayKey,
  messageGrouping,
  toTimelineMessage,
} from "./timeline-display";

const labels = { today: "Hôm nay", yesterday: "Hôm qua" };
const now = new Date(2026, 8, 21, 15, 0);

describe("formatMessageDay", () => {
  it("names today and yesterday", () => {
    expect(formatMessageDay(new Date(2026, 8, 21, 8, 0).getTime(), "vi", labels, now)).toBe("Hôm nay");
    expect(formatMessageDay(new Date(2026, 8, 20, 23, 59).getTime(), "vi", labels, now)).toBe("Hôm qua");
  });

  it("uses the weekday within a week and the date beyond it", () => {
    expect(formatMessageDay(new Date(2026, 8, 18, 9, 0).getTime(), "en", labels, now)).toBe("Friday");
    expect(formatMessageDay(new Date(2026, 7, 2, 9, 0).getTime(), "en", labels, now)).toBe("August 2");
  });

  it("adds the year only for another year", () => {
    expect(formatMessageDay(new Date(2025, 11, 31, 9, 0).getTime(), "en", labels, now)).toBe("December 31, 2025");
  });

  it("defaults now to the current time", () => {
    expect(formatMessageDay(Date.now(), "vi", labels)).toBe("Hôm nay");
  });
});

describe("messageDayKey", () => {
  it("is equal within one local day and differs across midnight", () => {
    const a = messageDayKey(new Date(2026, 8, 21, 0, 1).getTime());
    const b = messageDayKey(new Date(2026, 8, 21, 23, 59).getTime());
    const c = messageDayKey(new Date(2026, 8, 22, 0, 0).getTime());
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe("formatMessageTime", () => {
  it("prints hours and minutes, and the full date for a screen reader", () => {
    const ts = new Date(2026, 8, 21, 9, 5).getTime();
    expect(formatMessageTime(ts, "vi")).toMatch(/09:05/);
    expect(formatMessageTime(ts, "vi")).toMatch(/09:05/);
    expect(formatMessageDateTime(ts, "en")).toMatch(/September 21, 2026/);
  });
});

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

function queued(clientMsgId: string, threadRootId?: string): PendingSend {
  return {
    workspaceId: "ws1",
    senderId: "u1",
    roomId: "room1",
    body: `queued ${clientMsgId}`,
    clientMsgId,
    threadRootId,
    createdAt: Date.parse("2026-09-05T08:00:00.000Z"),
    status: "queued",
  };
}

describe("queued thread replies", () => {
  it("keep queued thread replies out of the main timeline", () => {
    const messages = buildMainTimelineMessages({
      anchorRows: null,
      latestRows: [rootRecord],
      pending: [queued("c-main"), queued("c-thread", "root1")],
      currentUserId: "u1",
    });
    expect(messages.map((message) => message.clientMsgId ?? message.id)).toEqual(["root1", "c-main"]);
  });

  it("show the open thread's queued replies after the root until the server echoes them", () => {
    const pending = [queued("c-mine", "root1"), queued("c-other", "root2"), queued("c-main")];
    const queuedView = buildThreadViewMessages({ threadRoot: rootRecord, threadRows: undefined, pending, currentUserId: "u1" });
    expect(queuedView.map((message) => message.clientMsgId ?? message.id)).toEqual(["root1", "c-mine"]);
    expect(queuedView[1]?.pending?.status).toBe("queued");

    const echoed = buildThreadViewMessages({
      threadRoot: rootRecord,
      threadRows: [
        rootRecord,
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
      pending,
      currentUserId: "u1",
    });
    expect(echoed.map((message) => message.id)).toEqual(["root1", "reply1"]);
  });

  it("shows only the anchored page, without thread replies or local sends, while jumping to a message", () => {
    const reply = { ...rootRecord, id: "r", thread_root_id: "root1" };
    const messages = buildMainTimelineMessages({
      anchorRows: [rootRecord, reply],
      latestRows: [],
      pending: [queued("c-main")],
      currentUserId: "u1",
    });
    expect(messages.map((message) => message.id)).toEqual(["root1"]);
  });
});

describe("toTimelineMessage", () => {
  it("maps a record once and hands back the same object after", () => {
    const message = toTimelineMessage(rootRecord);
    expect(message).toMatchObject({ id: "root1", sender: "u2", ts: Date.parse(rootRecord.created_at), record: rootRecord });
    expect(toTimelineMessage(rootRecord)).toBe(message);
  });
});

describe("messageGrouping", () => {
  const at = (minute: number, sender = "u1", extra: { kind?: string; voiceCall?: unknown } = {}) => ({
    sender,
    ts: new Date(2026, 8, 21, 9, minute).getTime(),
    ...extra,
  });

  it("compacts a bubble under the same sender within five minutes", () => {
    const list = [at(0), at(4), at(10), at(11, "u2")];
    expect(messageGrouping(list, 0)).toEqual({ compactTop: false, showAvatar: true });
    expect(messageGrouping(list, 1)).toEqual({ compactTop: true, showAvatar: false });
    expect(messageGrouping(list, 2)).toEqual({ compactTop: false, showAvatar: true });
    expect(messageGrouping(list, 3)).toEqual({ compactTop: false, showAvatar: true });
    expect(messageGrouping(list, 9)).toEqual({ compactTop: false, showAvatar: true });
  });

  it("never compacts a card or a bubble under a card", () => {
    const list = [at(0, "u1", { kind: "poll" }), at(1), at(2, "u1", { kind: "file" }), at(3, "u1", { voiceCall: {} })];
    expect(messageGrouping(list, 1)).toEqual({ compactTop: false, showAvatar: true });
    expect(messageGrouping(list, 2)).toEqual({ compactTop: false, showAvatar: true });
    expect(messageGrouping(list, 3)).toEqual({ compactTop: false, showAvatar: true });
  });

  it("does not compact across midnight", () => {
    const list = [
      { sender: "u1", ts: new Date(2026, 8, 21, 23, 59).getTime() },
      { sender: "u1", ts: new Date(2026, 8, 22, 0, 1).getTime() },
    ];
    expect(messageGrouping(list, 1).compactTop).toBe(false);
  });
});

describe("buildTimelineRows", () => {
  it("puts a day separator before each new day and keeps the grouping", () => {
    const day1 = new Date(2026, 8, 21, 9, 0).getTime();
    const day2 = new Date(2026, 8, 22, 9, 0).getTime();
    const rows = buildTimelineRows([
      { id: "a", sender: "u1", body: "", ts: day1 },
      { id: "b", sender: "u1", body: "", ts: day1 + 60_000 },
      { id: "c", sender: "u1", body: "", ts: day2 },
    ]);
    expect(rows.map((row) => (row.type === "day" ? row.type : `${row.key}:${row.compactTop}`))).toEqual([
      "day",
      "a:false",
      "b:true",
      "day",
      "c:false",
    ]);
  });
});
