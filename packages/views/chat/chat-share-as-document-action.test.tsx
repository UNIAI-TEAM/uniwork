import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatShareAsDocumentAction } from "./chat-share-as-document-action";

initI18n();

const useShareChatMessageAsDocumentMock = vi.fn();

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useShareChatMessageAsDocument: (...a: unknown[]) => useShareChatMessageAsDocumentMock(...a),
}));

function shareableMessage(): ChatMessage {
  return {
    id: "m-file",
    sender: "u1",
    body: "a.pdf",
    kind: "file",
    ts: Date.now(),
    reactions: {},
    canShareAsDocument: true,
    file: { filename: "a.pdf", content_type: "application/pdf", size_bytes: 10 },
  };
}

describe("ChatShareAsDocumentAction", () => {
  beforeEach(() => {
    useShareChatMessageAsDocumentMock.mockReset().mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("renders the share action button", () => {
    render(
      wrapWithNav(
        <ChatShareAsDocumentAction workspaceId="ws1" roomId="room1" message={shareableMessage()} />,
      ),
    );
    expect(screen.getByRole("button", { name: "Chia sẻ dạng tài liệu" })).toBeInTheDocument();
  });

  it("sends the chosen level and the message id on convert", async () => {
    const mutate = vi.fn();
    useShareChatMessageAsDocumentMock.mockReturnValue({ mutate, isPending: false });
    render(
      wrapWithNav(
        <ChatShareAsDocumentAction workspaceId="ws1" roomId="room1" message={shareableMessage()} />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ dạng tài liệu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Chỉ xem" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "m-file",
        share_level: "view",
        client_msg_id: expect.any(String),
      }),
      expect.anything(),
    );
  });
});
