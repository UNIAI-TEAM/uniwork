import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatMessageRow, chatBubbleShape } from "./chat-message-row";
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
    expect(screen.getByRole("button", { name: "Xem thông tin của Alice" })).toBeInTheDocument();
    expect(screen.getByText("Hello team")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("names the sender on a run's first bubble and puts the avatar on its last", () => {
    const row = (overrides: { showAvatar: boolean; lastOfRun: boolean; id: string }) => (
      <ChatMessageRow
        message={message({ id: overrides.id })}
        senderLabel="Alice"
        isOwn={false}
        showReadReceipt={false}
        showSenderName
        showAvatar={overrides.showAvatar}
        lastOfRun={overrides.lastOfRun}
      />
    );
    const { rerender } = render(wrap(row({ id: "first", showAvatar: true, lastOfRun: false })));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xem thông tin của Alice" })).not.toBeInTheDocument();

    rerender(wrap(row({ id: "last", showAvatar: false, lastOfRun: true })));
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xem thông tin của Alice" })).toBeInTheDocument();
  });

  it("shows the sender email when the avatar is focused", async () => {
    render(
      wrap(
        <ChatMessageRow
          message={message()}
          senderLabel="Alice"
          isOwn={false}
          showReadReceipt={false}
          nameContext={[{ user_id: "@peer:localhost", display_name: "Alice", email: "alice@example.com" }]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Alice" }));
    expect(await screen.findByRole("dialog", { name: "Alice" })).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("renders own message with read receipt and reply preview", () => {
    render(
      wrap(
        <ChatMessageRow
          message={message({ body: "My reply" })}
          senderLabel="Me"
          isOwn
          showReadReceipt
          workspaceId="ws1"
          roomId="room1"
          replyToMessage={message({ id: "m0", body: "Earlier message" })}
          onReply={vi.fn()}
          onReact={vi.fn()}
        />,
      ),
    );

    expect(screen.getByText("My reply")).toBeInTheDocument();
    expect(screen.getByText("Earlier message")).toBeInTheDocument();
    expect(screen.getByText("Đã xem")).toBeInTheDocument();
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

    fireEvent.click(screen.getByLabelText("Thả 👍"));
    fireEvent.click(screen.getByLabelText("Trả lời"));
    expect(onReact).toHaveBeenCalledWith(row);
    expect(onReply).toHaveBeenCalledWith(row);
  });

  it("names the quoted sender inside the quote", () => {
    render(
      wrap(
        <ChatMessageRow
          message={message({ body: "Đồng ý" })}
          senderLabel="Alice"
          isOwn={false}
          showReadReceipt={false}
          replyToMessage={message({ id: "m0", sender: "@lan:localhost", body: "Chốt lịch" })}
          replyToSenderLabel="Hoàng Lan"
          onJumpToMessage={vi.fn()}
        />,
      ),
    );
    const quote = screen.getByRole("button", { name: "Xem tin gốc: Chốt lịch" });
    expect(quote).toHaveTextContent("Hoàng Lan");
  });
});

describe("chatBubbleShape", () => {
  it("joins a run on the sender's side and ends it in a tail corner", () => {
    expect(chatBubbleShape(false, true)).toBe("rounded-[18px] rounded-bl-[4px]");
    expect(chatBubbleShape(false, true, false)).toBe("rounded-[18px] rounded-bl-sm");
    expect(chatBubbleShape(false, false, false)).toBe("rounded-[18px] rounded-tl-sm rounded-bl-sm");
    expect(chatBubbleShape(false, false, true)).toBe("rounded-[18px] rounded-tl-sm rounded-bl-[4px]");
    expect(chatBubbleShape(true, false, true)).toBe("rounded-[18px] rounded-tr-sm rounded-br-[4px]");
  });
});

