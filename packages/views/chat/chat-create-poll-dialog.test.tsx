import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatCreatePollDialog } from "./chat-create-poll-dialog";

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

describe("ChatCreatePollDialog", () => {
  it("creates a poll through the chat API", async () => {
    render(
      wrap(
        <ChatCreatePollDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Chủ đề bình chọn"), {
      target: { value: "Ăn trưa ở đâu?" },
    });
    fireEvent.change(screen.getByPlaceholderText("Lựa chọn 1"), { target: { value: "Canteen" } });
    fireEvent.change(screen.getByPlaceholderText("Lựa chọn 2"), { target: { value: "Quán ngoài" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo bình chọn" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: "room1",
          poll: expect.objectContaining({
            question: "Ăn trưa ở đâu?",
            options: ["Canteen", "Quán ngoài"],
          }),
        }),
      );
    });
  });

  it("adds another option row", () => {
    render(
      wrap(
        <ChatCreatePollDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thêm lựa chọn" }));
    expect(screen.getByPlaceholderText("Lựa chọn 3")).toBeInTheDocument();
  });
});
