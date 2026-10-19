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

type ShareMutate = (
  vars: { messageId: string; share_level: string; client_msg_id: string },
  opts?: { onSuccess?: () => void; onError?: (err: unknown) => void },
) => void;
const shareMutateImpl: ShareMutate = () => undefined;

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

  it("keeps the same client_msg_id when an errored intent is retried (RFC-06)", async () => {
    // A retry of the same intent replays under the same key: a network error
    // after the server committed must not mint a second document.
    const mutate = vi.fn(shareMutateImpl);
    useShareChatMessageAsDocumentMock.mockReturnValue({ mutate, isPending: false });
    render(
      wrapWithNav(
        <ChatShareAsDocumentAction workspaceId="ws1" roomId="room1" message={shareableMessage()} />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ dạng tài liệu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nhận xét" }));
    const firstKey = mutate.mock.calls[0]![0].client_msg_id;
    mutate.mock.calls[0]![1]?.onError?.(new Error("network down"));

    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ dạng tài liệu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Nhận xét" }));
    const secondKey = mutate.mock.calls[1]![0].client_msg_id;
    expect(secondKey).toBe(firstKey);
  });

  it("mints a new client_msg_id for the next intent after a success (RFC-06)", async () => {
    const mutate = vi.fn(shareMutateImpl);
    useShareChatMessageAsDocumentMock.mockReturnValue({ mutate, isPending: false });
    render(
      wrapWithNav(
        <ChatShareAsDocumentAction workspaceId="ws1" roomId="room1" message={shareableMessage()} />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ dạng tài liệu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Chỉ xem" }));
    const firstKey = mutate.mock.calls[0]![0].client_msg_id;
    mutate.mock.calls[0]![1]?.onSuccess?.();

    fireEvent.click(screen.getByRole("button", { name: "Chia sẻ dạng tài liệu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Chỉnh sửa" }));
    const secondKey = mutate.mock.calls[1]![0].client_msg_id;
    expect(secondKey).not.toBe(firstKey);
  });
});
