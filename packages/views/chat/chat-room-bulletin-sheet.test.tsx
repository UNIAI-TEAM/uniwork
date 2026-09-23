import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { requestMock, wrap } from "../test/api-mock";
import { ChatRoomBulletinSheet } from "./chat-room-bulletin-sheet";

initI18n();

const note = (id: string, body: string, created_at = "2026-03-26T10:00:00Z") => ({
  id,
  room_id: "room1",
  workspace_id: "ws1",
  sender_id: "u2",
  sender_display_name: "Binh",
  body: "",
  kind: "note",
  created_at,
  note: { body, pin_to_top: false },
});

const messagesState: { isPending: boolean; isError: boolean; rows: unknown[] | null; refetch: () => void } = {
  isPending: false,
  isError: false,
  rows: null,
  refetch: vi.fn(),
};

vi.mock("@uniwork/core/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/chat")>();
  return {
    ...actual,
    useChatRoomMessages: () => ({
      isPending: messagesState.isPending,
      isError: messagesState.isError,
      refetch: messagesState.refetch,
      data: messagesState.isPending || messagesState.isError ? undefined : (messagesState.rows ?? [note("m1", "hello note")]),
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

  afterEach(() => {
    messagesState.isError = false;
    messagesState.rows = null;
    requestMock.mockReset();
  });

  it("says the read failed, with a retry, instead of calling the room empty", () => {
    messagesState.isError = true;
    render(wrap(<ChatRoomBulletinSheet open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" title="Bảng tin" />));
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được tin của phòng.");
    expect(screen.queryByText("Phòng chưa có tin nào.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(messagesState.refetch).toHaveBeenCalled();
  });

  it("names the dialog with its one visible heading", () => {
    render(
      wrap(<ChatRoomBulletinSheet open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" title="Bảng tin nhóm" />),
    );
    expect(screen.getByRole("dialog", { name: "Bảng tin nhóm" })).toBeInTheDocument();
    expect(screen.getAllByText("Bảng tin nhóm")).toHaveLength(1);
  });

  it("loads older messages past the window on request, without marking the room read", async () => {
    messagesState.rows = Array.from({ length: 80 }, (_, i) =>
      ({ ...note(`w${i}`, `tin ${i}`), kind: "text", note: undefined, body: `tin ${i}`, created_at: `2026-03-26T10:${String(i % 60).padStart(2, "0")}:00Z` }),
    );
    requestMock.mockResolvedValue({ messages: [note("old1", "ghi chú cũ", "2026-03-01T08:00:00Z")] });
    render(wrap(<ChatRoomBulletinSheet open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" title="Bảng tin" />));

    fireEvent.click(screen.getByRole("button", { name: "Tải tin cũ hơn" }));
    expect(await screen.findByText("ghi chú cũ")).toBeInTheDocument();
    const [path] = requestMock.mock.calls[0] as [string];
    expect(path).toContain("/chat/rooms/room1/messages?");
    expect(path).toContain("before=2026-03-26T10%3A00%3A00Z");
    expect(path).toContain("mark_read=0");
    // A short page means the start of the room: nothing more to load.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Tải tin cũ hơn" })).toBeNull());
  });
});
