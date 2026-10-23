import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { wrap } from "../test/api-mock";
import { ChatImageAlbumRow } from "./chat-image-album";
import type { ChatMessage } from "./chat-messages";
import { layoutNativeChatMessages } from "./native-chat-message-item";

const T0 = Date.parse("2026-10-18T09:00:00");
const LATER = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function photo(id: string, index: number): ChatMessage {
  return {
    id,
    sender: "u2",
    body: "",
    kind: "file",
    ts: T0 + index * 1000,
    reactions: {},
    file: {
      filename: `${id}.jpg`,
      content_type: "image/jpeg",
      size_bytes: 1,
      url: `https://storage.test/${id}.jpg`,
      thumb_url: `https://storage.test/${id}-thumb.jpg`,
      download_url: `https://storage.test/${id}.jpg?download`,
      url_expires_at: LATER,
    },
  };
}

const album = ["p1", "p2", "p3", "p4", "p5"].map(photo);

function renderAlbum(photos: ChatMessage[] = album) {
  return render(
    wrap(
      <ChatImageAlbumRow
        workspaceId="ws1"
        roomId="room1"
        album={photos}
        senderLabel="Hoàng Lan"
        isOwn={false}
        showSenderName
        compactTop={false}
        showAvatar
        onReply={vi.fn()}
        onReact={vi.fn()}
      />,
    ),
  );
}

describe("layoutNativeChatMessages albums", () => {
  it("draws back-to-back photos on the first row and leaves the others empty", () => {
    const text: ChatMessage = { id: "t1", sender: "u2", body: "xem nhé", ts: T0 + 9000, reactions: {} };
    const layout = layoutNativeChatMessages([...album.slice(0, 3), text], {
      currentUserId: "u1",
      youLabel: "Bạn",
      nameContext: [],
      peerLastReadAt: null,
    });
    expect(layout.map((row) => row.album?.map((message) => message.id))).toEqual([
      ["p1", "p2", "p3"],
      undefined,
      undefined,
      undefined,
    ]);
    expect(layout.map((row) => row.inAlbum)).toEqual([false, true, true, false]);
  });
});

describe("ChatImageAlbumRow", () => {
  it("shows four tiles, +N for the rest, and keeps every photo's anchor", () => {
    const { container } = renderAlbum();
    expect(screen.getByRole("group", { name: "Album 5 ảnh" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Xem p\d\.jpg$/ })).toHaveLength(4);
    expect(screen.getByText("+1")).toBeInTheDocument();
    // The article carries the first photo's id; each other photo has its own.
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
      expect(container.querySelector(`#chat-msg-${id}`)).not.toBeNull();
    }
  });

  it("opens the viewer at the tile, steps with arrows and keys, and offers the download", async () => {
    renderAlbum();
    fireEvent.click(screen.getByRole("button", { name: "Xem p2.jpg" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("2 / 5");
    expect(dialog).toHaveTextContent("Hoàng Lan");
    expect(await screen.findByRole("img", { name: "p2.jpg" })).toHaveAttribute("src", "https://storage.test/p2.jpg");
    expect(screen.getByRole("button", { name: "Tải xuống" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ảnh sau" }));
    expect(dialog).toHaveTextContent("3 / 5");
    expect(await screen.findByRole("img", { name: "p3.jpg" })).toHaveAttribute("src", "https://storage.test/p3.jpg");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(dialog).toHaveTextContent("1 / 5");
    // Wraps from the first photo to the last.
    fireEvent.click(screen.getByRole("button", { name: "Ảnh trước" }));
    expect(dialog).toHaveTextContent("5 / 5");
  });
});
