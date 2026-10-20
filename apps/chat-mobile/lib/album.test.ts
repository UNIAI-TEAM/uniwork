// The cases of packages/views/chat/native-chat-message-grouping.test.ts › imageAlbumSpans, on timeline messages.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { albumsOf, imageAlbumSpans, isAlbumPhoto } from "./album";
import type { TimelineMessage } from "./timeline-display";

const base = new Date(2026, 9, 18, 9, 0).getTime();
function photo(id: string, sender: string, minute: number, extra: Record<string, unknown> = {}): TimelineMessage {
  const record = ChatMessageSchema.parse({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: sender,
    sender_display_name: sender,
    body: "",
    kind: "file",
    created_at: new Date(base + minute * 60_000).toISOString(),
    file: { id: `f-${id}`, filename: `${id}.jpg`, content_type: "image/jpeg", size_bytes: 1, url: `https://x/${id}.jpg` },
    ...extra,
  });
  return { id, sender, body: "", kind: "file", ts: base + minute * 60_000, record };
}
const text = (id: string, sender: string, minute: number): TimelineMessage => ({ id, sender, body: "hi", kind: "text", ts: base + minute * 60_000 });

describe("album", () => {
  it("joins one person's photos sent within two minutes", () => {
    const rows = [photo("a", "u1", 0), photo("b", "u1", 1), photo("c", "u1", 2), text("t", "u1", 3), photo("d", "u1", 4)];
    expect(imageAlbumSpans(rows)).toEqual([{ start: 0, end: 3 }]);
    const { byFirstId, folded } = albumsOf(rows);
    expect(byFirstId.get("a")?.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect([...folded]).toEqual(["b", "c"]);
  });

  it("breaks at another sender, a gap past two minutes, or a photo with its own life", () => {
    expect(imageAlbumSpans([photo("a", "u1", 0), photo("b", "u2", 1)])).toEqual([]);
    expect(imageAlbumSpans([photo("a", "u1", 0), photo("b", "u1", 3)])).toEqual([]);
    expect(isAlbumPhoto(photo("r", "u1", 0, { reactions: { "👍": 1 } }))).toBe(false);
    expect(isAlbumPhoto(photo("g", "u1", 0, { file: { id: "f", filename: "x.gif", content_type: "image/gif", size_bytes: 1 } }))).toBe(false);
    expect(isAlbumPhoto(text("t", "u1", 0))).toBe(false);
  });

  it("stops an album at ten photos", () => {
    const rows = Array.from({ length: 12 }, (_, i) => photo(`p${i}`, "u1", i * 0.1));
    expect(imageAlbumSpans(rows)).toEqual([{ start: 0, end: 10 }, { start: 10, end: 12 }]);
  });
});
