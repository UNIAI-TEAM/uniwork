import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat-messages";
import { imageAlbumSpans } from "./native-chat-message-grouping";

const T0 = Date.parse("2026-10-18T09:00:00");

function photo(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    sender: "u1",
    body: "",
    kind: "file",
    ts: T0,
    reactions: {},
    file: { filename: `${id}.jpg`, content_type: "image/jpeg", size_bytes: 1 },
    ...overrides,
  };
}

const text = (id: string, ts = T0): ChatMessage => ({ id, sender: "u1", body: "hi", ts, reactions: {} });

describe("imageAlbumSpans", () => {
  it("joins one person's back-to-back photos", () => {
    const messages = [photo("a"), photo("b", { ts: T0 + 60_000 }), photo("c", { ts: T0 + 170_000 })];
    expect(imageAlbumSpans(messages)).toEqual([{ start: 0, end: 3 }]);
  });

  it("never makes an album of one photo", () => {
    expect(imageAlbumSpans([photo("a"), text("t")])).toEqual([]);
  });

  it("breaks on text between, another sender, a long pause or a new day", () => {
    const messages = [
      photo("a"),
      photo("b"),
      text("t"),
      photo("c"),
      photo("d", { sender: "u2" }),
      photo("e", { sender: "u2", ts: T0 + 3 * 60_000 }),
      photo("f", { sender: "u2", ts: Date.parse("2026-10-18T23:59:30") }),
      photo("g", { sender: "u2", ts: Date.parse("2026-10-19T00:00:30") }),
    ];
    expect(imageAlbumSpans(messages)).toEqual([{ start: 0, end: 2 }]);
  });

  it("keeps GIFs, other files, quotes, reactions, threads and unsent photos out", () => {
    const messages = [
      photo("a"),
      photo("gif", { file: { filename: "x.gif", content_type: "image/gif", size_bytes: 1 } }),
      photo("pdf", { file: { filename: "x.pdf", content_type: "application/pdf", size_bytes: 1 } }),
      photo("quote", { replyToEventId: "m0" }),
      photo("liked", { reactions: { "👍": 1 } }),
      photo("thread", { replyCount: 2 }),
      photo("sending", { deliveryStatus: "sending" }),
    ];
    expect(imageAlbumSpans(messages)).toEqual([]);
  });

  it("caps an album at ten and starts a new one after", () => {
    const messages = Array.from({ length: 12 }, (_, i) => photo(`p${i}`, { ts: T0 + i * 1000 }));
    expect(imageAlbumSpans(messages)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 12 },
    ]);
  });

  it("starts a new album at the unread line", () => {
    const messages = [photo("a"), photo("b"), photo("c"), photo("d")];
    expect(imageAlbumSpans(messages, 2)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});
