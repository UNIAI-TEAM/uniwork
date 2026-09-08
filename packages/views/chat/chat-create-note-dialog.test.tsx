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

  it("disables pin checkbox when user cannot pin content", () => {
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

    expect(screen.getByRole("checkbox", { name: "Ghim lên đầu trò chuyện" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
