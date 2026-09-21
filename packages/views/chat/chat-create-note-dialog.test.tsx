import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatCreateNoteDialog } from "./chat-create-note-dialog";

const mutateAsync = vi.fn().mockResolvedValue({ id: "msg1" });

vi.mock("@uniwork/core/chat", () => ({
  useSendChatRoomMessage: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

beforeAll(() => {
  initI18n();
});

describe("ChatCreateNoteDialog", () => {
  it("creates a note through the chat API", async () => {
    mutateAsync.mockClear();

    render(
      wrap(
        <ChatCreateNoteDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
          canPinToTop
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Nội dung"), {
      target: { value: "Link tài liệu sprint" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo ghi chú" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: "room1",
          note: {
            body: "Link tài liệu sprint",
            pin_to_top: false,
          },
        }),
      );
    });
  });

  // Pin to top is a Switch now, the same control the poll dialog uses.
  it("disables the pin switch and says why when the user cannot pin", () => {
    render(
      wrap(
        <ChatCreateNoteDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
          canPinToTop={false}
        />,
      ),
    );

    const pin = screen.getByRole("switch", { name: "Ghim lên đầu trò chuyện" });
    expect(pin).toHaveAttribute("aria-disabled", "true");
    expect(pin).toHaveAccessibleDescription("Bạn không có quyền ghim nội dung lên đầu hội thoại.");
  });
});
