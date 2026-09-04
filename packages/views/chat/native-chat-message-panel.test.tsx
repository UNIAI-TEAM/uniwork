import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { NativeChatMessagePanel } from "./native-chat-message-panel";

const toggleReaction = vi.fn().mockResolvedValue(undefined);

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useChatRoomMessages: () => ({
    data: [
      {
        id: "m1",
        sender_id: "u2",
        body: "Hi team",
        kind: "text",
        created_at: "2026-01-01T10:00:00.000Z",
        reply_to_message_id: undefined,
        reactions: {},
      },
      {
        id: "m2",
        sender_id: "self",
        body: "Reply",
        kind: "text",
        created_at: "2026-01-01T10:01:00.000Z",
        reply_to_message_id: "m1",
        reactions: { "👍": 1 },
      },
    ],
  }),
  useToggleChatReaction: () => ({ mutateAsync: toggleReaction }),
}));

vi.mock("@uniwork/core/api/endpoints/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/chat")>()),
  listChatRoomMessages: vi.fn().mockResolvedValue([]),
}));

beforeAll(() => {
  initI18n();
});

describe("NativeChatMessagePanel", () => {
  it("renders messages and clears an active reply", () => {
    const onReplyToChange = vi.fn();
    const replyTo = {
      id: "m1",
      sender: "u2",
      body: "Hi team",
      ts: Date.parse("2026-01-01T10:00:00.000Z"),
      reactions: {},
    };

    render(
      wrap(
        <NativeChatMessagePanel
          workspaceId="ws1"
          roomId="room1"
          currentUserId="self"
          nameContext={[{ user_id: "u2", display_name: "Binh" }]}
          emptyLabel="No messages"
          youLabel="You"
          replyTo={replyTo}
          onReplyToChange={onReplyToChange}
        />,
      ),
    );

    expect(screen.getAllByText("Hi team").length).toBeGreaterThan(0);
    expect(screen.getByText("Reply")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(onReplyToChange).toHaveBeenCalledWith(null);
  });
});
