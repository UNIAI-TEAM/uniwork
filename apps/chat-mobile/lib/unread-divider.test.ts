// Parity: the web's unread line (native-chat-message-item.tsx › firstUnreadIndex,
// use-chat-catch-up-ui.ts › unreadSinceOf), on the phone's timeline messages.
import { describe, expect, it } from "vitest";
import type { TimelineMessage } from "./timeline-display";
import { firstUnreadMessageId, UNREAD_BACKFILL_PAGES, unreadLineNeedsOlder, unreadSnapshot } from "./unread-divider";

const T = Date.UTC(2026, 9, 22, 2, 0);
const msg = (id: string, sender: string, second: number, extra: Partial<TimelineMessage> = {}): TimelineMessage => ({ id, sender, body: id, ts: T + second * 1000, ...extra });

describe("unreadSnapshot", () => {
  it("is the read pointer and count while the room has unread messages or mentions", () => {
    expect(unreadSnapshot({ unread_count: 3, mention_unread_count: 0, last_read_at: "2026-10-22T02:00:00Z" })).toEqual({ since: "2026-10-22T02:00:00Z", count: 3 });
    expect(unreadSnapshot({ unread_count: 0, mention_unread_count: 1, last_read_at: "2026-10-22T02:00:00Z" })).toEqual({ since: "2026-10-22T02:00:00Z", count: 0 });
  });

  it("is none for a read room, one never read, or no room", () => {
    expect(unreadSnapshot({ unread_count: 0, mention_unread_count: 0, last_read_at: "2026-10-22T02:00:00Z" })).toBeNull();
    expect(unreadSnapshot({ unread_count: 2, mention_unread_count: 0, last_read_at: undefined })).toBeNull();
    expect(unreadSnapshot(undefined)).toBeNull();
  });
});

describe("firstUnreadMessageId", () => {
  const since = new Date(T + 10_000).toISOString();

  it("is the first message from someone else after the pointer, skipping one's own and unsent ones", () => {
    const messages = [
      msg("old", "u2", 5),
      msg("mine", "me", 20),
      msg("pending", "u2", 21, { pending: { workspaceId: "w", roomId: "r", senderId: "u2", clientMsgId: "c", body: "", createdAt: 0, status: "queued" } }),
      msg("first", "u2", 30),
      msg("next", "u3", 40),
    ];
    expect(firstUnreadMessageId(messages, "me", since, false)).toBe("first");
  });

  it("reads the sub-second cursor where created_at is whole seconds", () => {
    const sameSecond = msg("same", "u2", 10, { record: { cursor: `${(T + 10_500) * 1000}.abc` } as never });
    expect(firstUnreadMessageId([sameSecond], "me", since, true)).toBe("same");
    const before = msg("before", "u2", 10, { record: { cursor: `${(T + 9_000) * 1000}.x` } as never });
    expect(firstUnreadMessageId([before], "me", since, true)).toBeNull();
    // An unreadable cursor falls back to the timestamp.
    expect(firstUnreadMessageId([msg("odd", "u2", 30, { record: { cursor: "zzz" } as never })], "me", since, true)).toBe("odd");
  });

  it("is none without a pointer, with an unreadable one, or with nothing new", () => {
    expect(firstUnreadMessageId([msg("a", "u2", 30)], "me", null, true)).toBeNull();
    expect(firstUnreadMessageId([msg("a", "u2", 30)], "me", "not a date", true)).toBeNull();
    expect(firstUnreadMessageId([msg("a", "u2", 1)], "me", since, true)).toBeNull();
  });

  it("draws no line when every loaded message is unread and older pages remain: the first unread is further up", () => {
    const allNew = [msg("mine", "me", 5), msg("a", "u2", 30), msg("b", "u2", 40)];
    expect(firstUnreadMessageId(allNew, "me", since, false)).toBeNull();
    expect(firstUnreadMessageId(allNew, "me", since, true)).toBe("a");
  });
});

describe("unreadLineNeedsOlder", () => {
  const since = new Date(T + 10_000).toISOString();
  const allNew = [msg("a", "u2", 30), msg("b", "u2", 40)];

  it("asks for older pages exactly when only the missing history keeps the line from being drawn", () => {
    expect(unreadLineNeedsOlder(allNew, "me", since, false)).toBe(true);
    // The history ends here: the line is drawn on what is loaded.
    expect(unreadLineNeedsOlder(allNew, "me", since, true)).toBe(false);
    // The pointer is inside what is loaded: the line is already drawn.
    expect(unreadLineNeedsOlder([msg("old", "u2", 5), ...allNew], "me", since, false)).toBe(false);
  });

  it("asks for nothing without a pointer or without anything unread loaded", () => {
    expect(unreadLineNeedsOlder(allNew, "me", null, false)).toBe(false);
    expect(unreadLineNeedsOlder([msg("mine", "me", 30)], "me", since, false)).toBe(false);
    expect(unreadLineNeedsOlder([], "me", since, false)).toBe(false);
  });

  it("bounds the search: a few pages, past one screen of a busy room", () => {
    expect(UNREAD_BACKFILL_PAGES).toBeGreaterThanOrEqual(3);
  });
});
