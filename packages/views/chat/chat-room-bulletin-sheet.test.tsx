import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { wrap } from "../test/api-mock";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";

initI18n();

vi.mock("@uniwork/core/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/chat")>();
  return {
    ...actual,
    useChatRoomMessages: () => ({
      data: [
        {
          id: "m1",
          room_id: "room1",
          workspace_id: "ws1",
          sender_id: "u2",
          sender_display_name: "Binh",
          body: "",
          kind: "note",
          created_at: "2026-03-26T10:00:00Z",
          note: { body: "hello note", pin_to_top: false },
        },
      ],
    }),
    useSendChatRoomMessage: () => ({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    }),
  };
});

describe("ChatRoomBulletinSheet", () => {
  it("lists server notes and opens the shared create note dialog", () => {
    render(
      wrap(
        <ChatRoomBulletinSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
          title="Bảng tin nhóm"
          canCreateNotes
          canCreatePolls
        />,
      ),
    );

    expect(screen.getByText("hello note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tạo ghi chú" }));
    expect(screen.getByRole("dialog", { name: "Tạo ghi chú" })).toBeInTheDocument();
  });
});
