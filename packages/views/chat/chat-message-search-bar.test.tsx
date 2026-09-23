import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatMessageSearchBar } from "./chat-message-search-bar";

const useSearchChatRoomMessages = vi.fn();

vi.mock("@uniwork/core/chat", () => ({
  useSearchChatRoomMessages: (...args: unknown[]) => useSearchChatRoomMessages(...args),
}));

beforeAll(() => {
  initI18n();
});

describe("ChatMessageSearchBar", () => {
  it("shows empty state after debounced query", async () => {
    useSearchChatRoomMessages.mockReturnValue({ data: [], isFetching: false });
    render(
      wrap(
        <ChatMessageSearchBar
          workspaceId="ws1"
          roomId="room1"
          currentUserId="me"
          nameContext={[]}
          youLabel="Bạn"
          onClose={vi.fn()}
          onJumpToMessage={vi.fn()}
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Tìm tin nhắn trong cuộc trò chuyện"), {
      target: { value: "hello" },
    });
    await vi.waitFor(() => {
      expect(screen.getByText("Không tìm thấy tin nhắn phù hợp")).toBeInTheDocument();
    });
  });

  const hit = {
    id: "m9",
    room_id: "room1",
    workspace_id: "ws1",
    sender_id: "u2",
    sender_display_name: "Tuấn",
    kind: "text",
    body: "[@Tuấn](mention://member/u2) gửi báo cáo tuần",
    created_at: "2026-09-01T03:00:00Z",
  };

  it("marks an accent-insensitive match in the readable text and ignores an IME Enter", async () => {
    useSearchChatRoomMessages.mockReturnValue({ data: [hit], isFetching: false });
    const onJump = vi.fn();
    render(
      wrap(
        <ChatMessageSearchBar
          workspaceId="ws1"
          roomId="room1"
          currentUserId="me"
          nameContext={[]}
          youLabel="Bạn"
          onClose={vi.fn()}
          onJumpToMessage={onJump}
        />,
      ),
    );
    const input = screen.getByLabelText("Tìm tin nhắn trong cuộc trò chuyện");
    fireEvent.change(input, { target: { value: "bao cao" } });
    await vi.waitFor(() => expect(screen.getByText("báo cáo")).toBeInTheDocument());
    expect(screen.getByText("báo cáo").tagName).toBe("MARK");
    expect(document.body.textContent).not.toContain("mention://");

    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onJump).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onJump).toHaveBeenCalledWith("m9");
  });

  it("puts focus back where it was when closed without a jump", async () => {
    useSearchChatRoomMessages.mockReturnValue({ data: [], isFetching: false });
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      wrap(
        <ChatMessageSearchBar
          workspaceId="ws1"
          roomId="room1"
          currentUserId="me"
          nameContext={[]}
          youLabel="Bạn"
          onClose={vi.fn()}
          onJumpToMessage={vi.fn()}
        />,
      ),
    );
    expect(screen.getByLabelText("Tìm tin nhắn trong cuộc trò chuyện")).toHaveFocus();
    view.unmount();
    await vi.waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });
});
