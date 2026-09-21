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

function renderDialog() {
  return render(
    wrap(<ChatCreatePollDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" />),
  );
}

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

    fireEvent.change(screen.getByLabelText("Câu hỏi"), {
      target: { value: "Ăn trưa ở đâu?" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Lựa chọn 1" }), { target: { value: "Canteen" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Lựa chọn 2" }), { target: { value: "Quán ngoài" } });
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
    expect(screen.getByRole("textbox", { name: "Lựa chọn 3" })).toHaveFocus();
  });

  it("removes an option only while more than two remain", () => {
    renderDialog();

    expect(screen.queryByRole("button", { name: /Bỏ lựa chọn/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thêm lựa chọn" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Lựa chọn 3" }), { target: { value: "Ba" } });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lựa chọn 1" }));

    expect(screen.getAllByRole("textbox", { name: /^Lựa chọn \d$/ })).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Lựa chọn 2" })).toHaveValue("Ba");
    expect(screen.queryByRole("button", { name: /Bỏ lựa chọn/ })).not.toBeInTheDocument();
  });

  it("groups the options and names every setting switch by its text", () => {
    renderDialog();

    expect(screen.getByRole("group", { name: "Các lựa chọn" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Ghim lên đầu trò chuyện" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Ẩn người bình chọn" })).toBeInTheDocument();
    expect(screen.getByText("Không thời hạn")).toBeInTheDocument();
  });
});
