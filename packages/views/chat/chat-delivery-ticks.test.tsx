import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wrap } from "../test/api-mock";
import { ChatPeerDeliveredAtContext } from "./chat-delivered";
import { ChatPeerReadAtContext } from "./chat-message-parts";
import { ChatMessageRow } from "./chat-message-row";
import type { ChatMessage } from "./chat-messages";

const SENT_AT = Date.parse("2026-10-18T10:00:00Z");

const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  sender: "me",
  body: "Chiều nay họp lúc 3 giờ nhé.",
  ts: SENT_AT,
  reactions: {},
  ...overrides,
});

function receipts(readAt: string | null, deliveredAt: string | null, children: ReactNode) {
  return (
    <ChatPeerDeliveredAtContext.Provider value={deliveredAt}>
      <ChatPeerReadAtContext.Provider value={readAt}>{children}</ChatPeerReadAtContext.Provider>
    </ChatPeerDeliveredAtContext.Provider>
  );
}

describe("own message ticks", () => {
  const row = <ChatMessageRow message={message()} senderLabel="Tôi" isOwn showReadReceipt={false} />;

  it("goes ✓ sent → ✓✓ delivered → ✓✓ seen as the cursors pass the message", () => {
    const { rerender } = render(wrap(receipts(null, "2026-10-18T09:59:59Z", row)));
    expect(screen.getByRole("img", { name: "Đã gửi" })).toBeInTheDocument();

    rerender(wrap(receipts(null, "2026-10-18T10:00:01Z", row)));
    expect(screen.getByRole("img", { name: "Đã tới máy người nhận" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Đã gửi" })).not.toBeInTheDocument();

    rerender(wrap(receipts("2026-10-18T10:00:01Z", "2026-10-18T10:00:01Z", row)));
    expect(screen.getByRole("img", { name: "Đã xem" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Đã tới máy người nhận" })).not.toBeInTheDocument();
  });

  it("never marks someone else's message", () => {
    render(
      wrap(
        receipts(
          "2026-10-18T10:00:01Z",
          "2026-10-18T10:00:01Z",
          <ChatMessageRow message={message({ sender: "ha" })} senderLabel="Hà" isOwn={false} showReadReceipt={false} />,
        ),
      ),
    );
    expect(screen.queryByRole("img", { name: /Đã/ })).not.toBeInTheDocument();
  });
});

describe("thread pill faces", () => {
  it("leads with the latest repliers' faces, three at most", () => {
    render(
      wrap(
        <ChatMessageRow
          message={message({ sender: "lan", replyCount: 4, threadParticipantIds: ["ha", "minh", "anh", "lan"] })}
          senderLabel="Lan"
          isOwn={false}
          showReadReceipt={false}
          onThread={vi.fn()}
          nameContext={[
            { user_id: "ha", display_name: "Nguyễn Thu Hà" },
            { user_id: "minh", display_name: "Võ Minh" },
            { user_id: "anh", display_name: "Đức Anh" },
            { user_id: "lan", display_name: "Hoàng Lan" },
          ]}
        />,
      ),
    );
    const pill = screen.getByRole("button", { name: /4 trả lời/ });
    expect(pill).toHaveTextContent(/^THVMĐA4 trả lời/);
  });

  it("draws no faces before the server names any", () => {
    render(
      wrap(
        <ChatMessageRow
          message={message({ sender: "lan", replyCount: 2 })}
          senderLabel="Lan"
          isOwn={false}
          showReadReceipt={false}
          onThread={vi.fn()}
        />,
      ),
    );
    expect(screen.getByRole("button", { name: /2 trả lời/ })).toHaveTextContent(/^2 trả lời/);
  });
});
