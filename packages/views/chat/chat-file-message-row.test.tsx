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
});
