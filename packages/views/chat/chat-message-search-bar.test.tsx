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
});
