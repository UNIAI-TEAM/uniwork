import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatFileMessageRow } from "./chat-file-message-row";

initI18n();

vi.mock("@uniwork/core/api/endpoints/chat", () => ({
  loadChatFileBlob: vi.fn(),
}));

import { loadChatFileBlob } from "@uniwork/core/api/endpoints/chat";

describe("ChatFileMessageRow", () => {
  beforeEach(() => {
    vi.mocked(loadChatFileBlob).mockReset();
  });

  it("renders filename, size, and download control for non-image files", () => {
    render(
      wrap(
        <ChatFileMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message1",
            sender: "user1",
            body: "sprint.pdf",
            kind: "file",
            ts: Date.now(),
            reactions: {},
            file: {
              filename: "sprint.pdf",
              content_type: "application/pdf",
              size_bytes: 2048,
            },
          }}
          senderLabel="An"
          isOwn
          showSenderName={false}
          compactTop={false}
          showAvatar={false}
        />,
      ),
    );

    expect(screen.getByText("sprint.pdf")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải tệp" })).toBeInTheDocument();
    expect(loadChatFileBlob).not.toHaveBeenCalled();
  });

  it("loads and shows an inline image preview", async () => {
    vi.mocked(loadChatFileBlob).mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });

    render(
      wrap(
        <ChatFileMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message2",
            sender: "user1",
            body: "long.png",
            kind: "file",
            ts: Date.now(),
            reactions: {},
            file: {
              filename: "long.png",
              content_type: "image/png",
              size_bytes: 116_326,
            },
          }}
          senderLabel="An"
          isOwn
          showSenderName={false}
          compactTop={false}
          showAvatar={false}
        />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "long.png" })).toHaveAttribute(
        "src",
        "blob:preview",
      );
    });
    expect(screen.getByRole("button", { name: "Mở tệp" })).toBeInTheDocument();
    expect(loadChatFileBlob).toHaveBeenCalledWith("ws1", "room1", "message2");
  });

  it("exposes message actions when handlers are provided", () => {
    vi.mocked(loadChatFileBlob).mockResolvedValue(
      new Blob(["png"], { type: "image/png" }),
    );
    const onReply = vi.fn();
    render(
      wrap(
        <ChatFileMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message3",
            sender: "user1",
            body: "long.png",
            kind: "file",
            ts: Date.now(),
            reactions: { "👍": 1 },
            file: {
              filename: "long.png",
              content_type: "image/png",
              size_bytes: 116_326,
            },
          }}
          senderLabel="An"
          isOwn
          showSenderName={false}
          compactTop={false}
          showAvatar={false}
          onReply={onReply}
          onReact={vi.fn()}
          onThread={vi.fn()}
          onPin={vi.fn()}
          onCopy={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Trả lời" }));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(screen.getByText("👍")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sửa" })).toBeDisabled();
  });

  it("formats byte sizes and shows peer sender chrome", () => {
    render(
      wrap(
        <ChatFileMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message3",
            sender: "user2",
            body: "tiny.txt",
            kind: "file",
            ts: Date.now(),
            reactions: { "🔥": 2 },
            file: {
              filename: "tiny.txt",
              content_type: "text/plain",
              size_bytes: 12,
            },
          }}
          senderLabel="Binh"
          isOwn={false}
          showSenderName
          compactTop
          showAvatar
        />,
      ),
    );
    expect(screen.getByText("12 B")).toBeInTheDocument();
    expect(screen.getByText("Binh")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("formats megabyte sizes and downloads non-image files", async () => {
    vi.mocked(loadChatFileBlob).mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    const createObjectURL = vi.fn(() => "blob:dl");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "a") {
        return { href: "", download: "", click } as unknown as HTMLAnchorElement;
      }
      return document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    }) as typeof document.createElement);

    render(
      wrap(
        <ChatFileMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message4",
            sender: "user1",
            body: "big.bin",
            kind: "file",
            ts: Date.now(),
            reactions: {},
            file: {
              filename: "big.bin",
              content_type: "application/octet-stream",
              size_bytes: 2 * 1024 * 1024,
            },
          }}
          senderLabel="An"
          isOwn
          showSenderName={false}
          compactTop={false}
          showAvatar={false}
        />,
      ),
    );
    expect(screen.getByText("2.0 MB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tải tệp" }));
    await waitFor(() => {
      expect(loadChatFileBlob).toHaveBeenCalledWith("ws1", "room1", "message4");
      expect(click).toHaveBeenCalled();
    });
  });

  it("shows an error state when image preview fails", async () => {
    vi.mocked(loadChatFileBlob).mockRejectedValueOnce(new Error("fail"));
    render(
      wrap(
        <ChatFileMessageRow
          workspaceId="ws1"
          roomId="room1"
          message={{
            id: "message5",
            sender: "user1",
            body: "broken.png",
            kind: "file",
            ts: Date.now(),
            reactions: {},
            file: {
              filename: "broken.png",
              content_type: "image/png",
              size_bytes: 10,
            },
          }}
          senderLabel="An"
          isOwn
          showSenderName={false}
          compactTop={false}
          showAvatar={false}
        />,
      ),
    );
    await waitFor(() => {
      expect(screen.getByText("Không tải được tệp.")).toBeInTheDocument();
    });
  });
});
