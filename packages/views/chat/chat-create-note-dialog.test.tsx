import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
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

    fireEvent.change(screen.getByRole("textbox", { name: /Nội dung/ }), {
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

  it("says why Create is not ready, then shows a failed send inline in the dialog", async () => {
    mutateAsync.mockClear();
    mutateAsync.mockRejectedValueOnce(new ApiError("raw server sentence", "rate_limited", 429));
    render(
      wrap(<ChatCreateNoteDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" canPinToTop />),
    );

    expect(screen.getByText("Cần nội dung ghi chú")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Nội dung/ })).toHaveAttribute("aria-required", "true");

    fireEvent.change(screen.getByRole("textbox", { name: /Nội dung/ }), { target: { value: "Ghi chú" } });
    expect(screen.queryByText("Cần nội dung ghi chú")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tạo ghi chú" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Bạn thao tác quá nhanh. Chờ một chút rồi thử lại.");
    expect(alert).not.toHaveTextContent("raw server sentence");
  });

  it("never sends a pin the viewer may not make", async () => {
    mutateAsync.mockClear();
    render(
      wrap(<ChatCreateNoteDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" canPinToTop={false} />),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Nội dung/ }), { target: { value: "Ghi chú" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo ghi chú" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ note: { body: "Ghi chú", pin_to_top: false } })),
    );
  });

  it("shows a length counter only near the limit", () => {
    render(
      wrap(<ChatCreateNoteDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" canPinToTop />),
    );
    const field = screen.getByRole("textbox", { name: /Nội dung/ });
    fireEvent.change(field, { target: { value: "ngắn" } });
    expect(screen.queryByText(/\/2000$/)).toBeNull();
    fireEvent.change(field, { target: { value: "a".repeat(1900) } });
    expect(screen.getByText("1900/2000")).toBeInTheDocument();
    expect(field).toHaveAccessibleDescription("1900/2000");
  });
});
