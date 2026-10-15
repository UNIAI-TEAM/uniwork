import { describe, expect, it } from "vitest";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat";
import { directRoomId, groupSharedItemsByMonth, groupsInCommon, sharedItemsFromMessages } from "./chat-person-shared";

function file(
  partial: Pick<NonNullable<ChatMessageRecord["file"]>, "filename" | "content_type" | "size_bytes"> &
    Partial<NonNullable<ChatMessageRecord["file"]>>,
): NonNullable<ChatMessageRecord["file"]> {
  return { url: "", download_url: "", thumb_url: "", url_expires_at: "", ...partial };
}

function message(partial: Partial<ChatMessageRecord> & Pick<ChatMessageRecord, "id" | "body">): ChatMessageRecord {
  return {
    room_id: "room",
    workspace_id: "ws",
    sender_id: "u2",
    sender_display_name: "Nam",
    kind: "text",
    created_at: "2026-10-15T02:00:00Z",
    reply_count: 0,
    thread_unread: false,
    pinned: false,
    mentioned_user_ids: [],
    reactions: {},
    ...partial,
  };
}

describe("sharedItemsFromMessages", () => {
  it("sorts photos, files, gifs and links, and skips stickers", () => {
    const shared = sharedItemsFromMessages([
      message({
        id: "p1",
        kind: "file",
        body: "a.jpg",
        file: file({ filename: "a.jpg", content_type: "image/jpeg", size_bytes: 1, url: "https://files/a.jpg", thumb_url: "https://files/a-thumb.jpg" }),
      }),
      message({
        id: "g1",
        kind: "file",
        body: "b.gif",
        file: file({ filename: "b.gif", content_type: "image/gif", size_bytes: 1, url: "https://files/b.gif" }),
      }),
      message({
        id: "f1",
        kind: "file",
        body: "note.pdf",
        file: file({ filename: "note.pdf", content_type: "application/pdf", size_bytes: 1, download_url: "https://files/note.pdf" }),
      }),
      message({ id: "m1", body: "![gif:vỗ tay](https://media.example/v.gif)" }),
      message({ id: "m2", body: "![sticker:ăn mừng](https://media.example/s.webp)" }),
      message({
        id: "v1",
        kind: "file",
        body: "clip.mp4",
        file: file({ filename: "clip.mp4", content_type: "video/mp4", size_bytes: 1, url: "https://files/clip.mp4" }),
      }),
      message({ id: "m3", body: "xem https://uniwork.vn/docs nhé" }),
    ]);

    expect(shared.photo.map((item) => item.title)).toEqual(["a.jpg"]);
    expect(shared.gif.map((item) => item.id)).toEqual(["g1", "m1"]);
    expect(shared.file.map((item) => item.title)).toEqual(["note.pdf"]);
    expect(shared.video.map((item) => item.title)).toEqual(["clip.mp4"]);
    expect(shared.link.map((item) => item.url)).toEqual(["https://uniwork.vn/docs"]);
  });

  it("keeps only the clicked person's messages", () => {
    const messages = [
      message({
        id: "mine",
        sender_id: "u2",
        kind: "file",
        body: "a.jpg",
        file: file({ filename: "a.jpg", content_type: "image/jpeg", size_bytes: 1 }),
      }),
      message({
        id: "theirs",
        sender_id: "u9",
        kind: "file",
        body: "b.jpg",
        file: file({ filename: "b.jpg", content_type: "image/jpeg", size_bytes: 1 }),
      }),
    ];
    expect(sharedItemsFromMessages(messages, "u2").photo.map((item) => item.id)).toEqual(["mine"]);
  });
});

describe("groupSharedItemsByMonth", () => {
  it("puts the newest month first and adds the year only for older years", () => {
    const groups = groupSharedItemsByMonth(
      [
        { id: "old", title: "old", at: "2025-06-02T00:00:00Z" },
        { id: "may", title: "may", at: "2026-05-14T00:00:00Z" },
        { id: "oct", title: "oct", at: "2026-10-01T00:00:00Z" },
      ],
      "en",
      new Date("2026-10-15T00:00:00Z"),
    );
    expect(groups.map((group) => group.key)).toEqual(["2026-9", "2026-4", "2025-5"]);
    expect(groups[0]?.label).not.toMatch(/2026/);
    expect(groups[2]?.label).toMatch(/2025/);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["oct"]);
  });
});

describe("groupsInCommon", () => {
  it("keeps group rooms the person belongs to", () => {
    const groups = groupsInCommon(
      [
        { id: "g1", kind: "group", name: "Nhóm A", member_user_ids: ["u2"] },
        { id: "g2", kind: "group", name: "Nhóm B", member_user_ids: ["u3"] },
        { id: "d1", kind: "dm", name: "Nam", member_user_ids: ["u2"] },
      ],
      "u2",
    );
    expect(groups).toEqual([{ id: "g1", roomId: "g1", name: "Nhóm A" }]);
  });
});

describe("directRoomId", () => {
  it("finds the existing direct room and does not invent one", () => {
    const rooms = [{ id: "dm-1", kind: "dm", peer_user_id: "U2" }];
    expect(directRoomId(rooms, "u2")).toBe("dm-1");
    expect(directRoomId(rooms, "u9")).toBeNull();
  });
});
