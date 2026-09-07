import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatMessageRow } from "./chat-message-row";
import type { ChatMessage } from "./chat-messages";

beforeAll(() => {
  initI18n();
});

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  sender: "@peer:localhost",
  body: "Hello team",
  ts: Date.now(),
  reactions: {},
  ...overrides,
});

describe("ChatMessageRow", () => {
  it("renders incoming message with sender name and reactions", () => {
    render(
      wrap(
        <ChatMessageRow
          message={message({ reactions: { "👍": 2 } })}
          senderLabel="Alice"
          isOwn={false}
          showReadReceipt={false}
          showSenderName
          onReply={vi.fn()}
          onReact={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Hello team")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders own message with read receipt and reply preview", () => {
    render(
      wrap(
        <ChatMessageRow
          message={message({ body: "My reply" })}
          senderLabel="Me"
          isOwn
          showReadReceipt
          replyPreview="Earlier message"
          onReply={vi.fn()}
          onReact={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("My reply")).toBeInTheDocument();
    expect(screen.getByText("Earlier message")).toBeInTheDocument();
    expect(screen.getByLabelText("Đã xem")).toBeInTheDocument();
  });

  it("shows delivery status for pending messages", () => {
    render(
      wrap(
        <ChatMessageRow
          message={message({ deliveryStatus: "sending" })}
          senderLabel="Me"
          isOwn
          showReadReceipt={false}
        />,
      ),
    );

    expect(screen.getByText("Đang gửi…")).toBeInTheDocument();
  });

  it("invokes reply and react handlers from action buttons", () => {
    const onReply = vi.fn();
    const onReact = vi.fn();
    const row = message();

    render(
      wrap(
        <ChatMessageRow
          message={row}
          senderLabel="Alice"
          isOwn={false}
          showReadReceipt={false}
          onReply={onReply}
          onReact={onReact}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Thêm cảm xúc"));
    fireEvent.click(screen.getByLabelText("Trả lời"));
    expect(onReact).toHaveBeenCalledWith(row);
    expect(onReply).toHaveBeenCalledWith(row);
  });
});
