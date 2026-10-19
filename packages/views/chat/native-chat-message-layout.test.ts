import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat-messages";
import { layoutNativeChatMessages } from "./native-chat-message-item";

const T0 = Date.parse("2026-10-18T09:00:00");
const at = (id: string, minutes: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  sender: "u2",
  body: id,
  ts: T0 + minutes * 60_000,
  reactions: {},
  ...extra,
});
const BASE = { currentUserId: "u1", youLabel: "Bạn", nameContext: [], peerLastReadAt: null };

describe("layoutNativeChatMessages", () => {
  it("points a call log at the UNI summary of that call", () => {
    const summary = at("s1", 2, {
      voiceCallSummary: { call_id: "c1", call_log_message_id: "log1", summary: "", highlights: [], action_items: [] },
    });
    const layout = layoutNativeChatMessages([at("log1", 0, { kind: "voice_call_log" }), at("m1", 1), summary], BASE);
    expect(layout.map((row) => row.callSummaryId)).toEqual(["s1", undefined, undefined]);
  });

  it("opens a thread's replies under its root with the reply count", () => {
    const layout = layoutNativeChatMessages([at("root", 0), at("r1", 1), at("r2", 2)], {
      ...BASE,
      threadRoot: { id: "root", replyCount: 2 },
    });
    expect(layout.map((row) => row.opensReplies)).toEqual([undefined, 2, undefined]);
  });

  it("in a thread, quotes no reply's root and opens on the root, not a day chip", () => {
    const layout = layoutNativeChatMessages([at("root", 0), at("r1", 1, { replyToEventId: "root" })], {
      ...BASE,
      threadRoot: { id: "root", replyCount: 1 },
    });
    expect(layout.map((row) => row.replyTarget)).toEqual([undefined, undefined]);
    expect(layout[0]?.opensDay).toBe(false);
  });
});
