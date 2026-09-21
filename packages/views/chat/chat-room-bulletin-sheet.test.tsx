import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { wrap } from "../test/api-mock";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";

initI18n();

const messagesState: { isPending: boolean } = { isPending: false };

vi.mock("@uniwork/core/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/chat")>();
  return {
    ...actual,
    useChatRoomMessages: () => ({
      isPending: messagesState.isPending,
      data: messagesState.isPending ? undefined : [
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
    // The four stacked create buttons became one "New" menu.
    fireEvent.click(screen.getByRole("button", { name: /bulletin_create_menu|Tạo mới/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tạo ghi chú" }));
    expect(screen.getByRole("dialog", { name: "Tạo ghi chú" })).toBeInTheDocument();
  });

  it("shows every view tab without create rights and no create menu", () => {
    render(
      wrap(
        <ChatRoomBulletinSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
          title="Bảng tin"
          canCreateNotes={false}
          canCreatePolls={false}
        />,
      ),
    );

    for (const name of ["Tất cả", "Tin ghim", "Bài đăng", "Ghi chú", "Bình chọn", "Nhắc hẹn"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: /bulletin_create_menu|Tạo mới/ })).not.toBeInTheDocument();
  });

  it("states the window it searched when a tab is empty", () => {
    render(
      wrap(
        <ChatRoomBulletinSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
          title="Bảng tin"
          initialTab="polls"
        />,
      ),
    );

    expect(screen.getByText(/bulletin_empty_polls_window|1 tin gần nhất/)).toBeInTheDocument();
  });

  it("shows a skeleton while messages load", () => {
    messagesState.isPending = true;
    try {
      render(
        wrap(
          <ChatRoomBulletinSheet open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" title="Bảng tin" />,
        ),
      );
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    } finally {
      messagesState.isPending = false;
    }
  });
});
