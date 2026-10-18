import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { wrap } from "../test/api-mock";
import { ChatPinnedMessagesBar } from "./chat-pinned-messages-bar";

initI18n();

const mutateAsync = vi.fn().mockResolvedValue({ id: "m1", pinned: false });

const pinnedRows = [
  {
    id: "m1",
    room_id: "room1",
    workspace_id: "ws1",
    sender_id: "u2",
    sender_display_name: "Binh",
    body: "hello pinned",
    kind: "note",
    created_at: "2026-03-26T10:00:00Z",
    pinned: true,
    note: { body: "hello pinned", pin_to_top: true },
  },
  {
    id: "m2",
    room_id: "room1",
    workspace_id: "ws1",
    sender_id: "u2",
    sender_display_name: "Binh",
    body: "second",
    kind: "text",
    created_at: "2026-03-26T11:00:00Z",
    pinned: true,
  },
];

vi.mock("@uniwork/core/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/chat")>();
  return {
    ...actual,
    useChatRoomMessages: () => ({
      data: pinnedRows,
    }),
    useToggleChatMessagePin: () => ({
      mutateAsync,
      isPending: false,
    }),
  };
});

describe("ChatPinnedMessagesBar", () => {
  it("shows one pin by default and expands on demand", () => {
    const onJump = vi.fn();
    render(
      wrap(
        <ChatPinnedMessagesBar
          workspaceId="ws1"
          roomId="room1"
          canPinMessages
          onJumpToMessage={onJump}
        />,
      ),
    );

    expect(screen.getByText(/second/i)).toBeInTheDocument();
    expect(screen.queryByText(/hello pinned/i)).not.toBeInTheDocument();

    expect(screen.getByText("Tin ghim 1/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem tất cả tin ghim" }));
    expect(screen.getByText(/hello pinned/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Thu gọn|Show less/i }));
    expect(screen.queryByText(/hello pinned/i)).not.toBeInTheDocument();
  });

  it("jumps to the visible pin on click", () => {
    const onJump = vi.fn();
    render(
      wrap(
        <ChatPinnedMessagesBar
          workspaceId="ws1"
          roomId="room1"
          canPinMessages
          onJumpToMessage={onJump}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /second/i }));
    expect(onJump).toHaveBeenCalledWith("m2");
    // The bar moves on to the next older pin, as "Tin ghim 2/2" says.
    expect(screen.getByText("Tin ghim 2/2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /hello pinned/i }));
    expect(onJump).toHaveBeenLastCalledWith("m1");
  });

  it("unpins from the pinned bar when allowed", () => {
    mutateAsync.mockClear();
    render(
      wrap(
        <ChatPinnedMessagesBar
          workspaceId="ws1"
          roomId="room1"
          canPinMessages
          onJumpToMessage={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xem tất cả tin ghim" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Bỏ ghim" })[0]!);
    expect(mutateAsync).toHaveBeenCalledWith({ roomId: "room1", messageId: "m2" });
  });
});
