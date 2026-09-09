import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatReplyQuote, replyPreviewLabel } from "./chat-reply-quote";

initI18n();

vi.mock("@uniwork/core/api/endpoints/chat", () => ({
  loadChatFileBlob: vi.fn(),
}));

import { loadChatFileBlob } from "@uniwork/core/api/endpoints/chat";

const imageMessage = (): ChatMessage => ({
  id: "img1",
  sender: "u1",
  body: "photo.png",
  kind: "file",
  ts: Date.now(),
  reactions: {},
  file: {
    filename: "photo.png",
    content_type: "image/png",
    size_bytes: 1200,
  },
});

describe("chat-reply-quote", () => {
  beforeEach(() => {
    vi.mocked(loadChatFileBlob).mockReset();
  });

  it("labels voice and file replies", () => {
    expect(
      replyPreviewLabel(
        { id: "v1", sender: "u1", body: "", kind: "voice", ts: 1, reactions: {} },
        { voice: "Tin nhắn thoại", file: "Tệp" },
      ),
    ).toBe("Tin nhắn thoại");
    expect(
      replyPreviewLabel(imageMessage(), { voice: "Tin nhắn thoại", file: "Tệp" }),
    ).toBe("photo.png");
  });

  it("shows a thumbnail for image replies", async () => {
    vi.mocked(loadChatFileBlob).mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:thumb"),
      revokeObjectURL: vi.fn(),
    });

    render(
      wrap(
        <ChatReplyQuote
          message={imageMessage()}
          workspaceId="ws1"
          roomId="room1"
          isOwn
        />,
      ),
    );

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "photo.png" })).toHaveAttribute(
        "src",
        "blob:thumb",
      );
    });
    expect(screen.getByText("photo.png")).toBeInTheDocument();
  });
});
