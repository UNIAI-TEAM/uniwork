import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetChatSendOutboxForTests, useChatSendOutboxStore } from "@uniwork/core/chat/send-outbox-store";
import { requestMock, wrap } from "../test/api-mock";
import { ChatMessageRow } from "./chat-message-row";
import type { ChatMessage } from "./chat-messages";

const failed: ChatMessage = {
  id: "pending:cmid-f",
  clientMsgId: "cmid-f",
  sender: "u1",
  body: "Gửi lại file kịch bản",
  ts: Date.now(),
  reactions: {},
  deliveryStatus: "failed",
};

function renderFailed() {
  return render(
    wrap(
      <ChatMessageRow workspaceId="ws1" roomId="room1" message={failed} senderLabel="Bạn" isOwn showReadReceipt={false} />,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  resetChatSendOutboxForTests();
  useChatSendOutboxStore.getState().enqueue({
    workspaceId: "ws1",
    senderId: "u1",
    roomId: "room1",
    body: failed.body,
    client_msg_id: "cmid-f",
    queued_at: new Date().toISOString(),
    failed_at: new Date().toISOString(),
  });
});

describe("a failed send", () => {
  it("keeps its bubble and says it was not sent, with retry and discard", () => {
    renderFailed();
    expect(screen.getByText(failed.body)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa gửi được");
    expect(screen.getByRole("button", { name: "Gửi lại tin nhắn này" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bỏ tin này" })).toBeInTheDocument();
    // Not on the server: no reply, react or delete on it.
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("sends the same client_msg_id again and leaves the queue once sent", async () => {
    requestMock.mockResolvedValue(null);
    renderFailed();
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại tin nhắn này" }));

    await waitFor(() => expect(useChatSendOutboxStore.getState().entries).toEqual([]));
    const [path, init] = requestMock.mock.calls[0] ?? [];
    expect(path).toContain("/chat/rooms/room1/messages");
    expect(JSON.stringify(init)).toContain("cmid-f");
  });

  it("drops the message when asked", () => {
    renderFailed();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ tin này" }));
    expect(useChatSendOutboxStore.getState().entries).toEqual([]);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
