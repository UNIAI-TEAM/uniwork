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

function renderDialog(canPinToTop = true) {
  return render(
    wrap(
      <ChatCreatePollDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" canPinToTop={canPinToTop} />,
    ),
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
          canPinToTop
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
          canPinToTop
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

  it("keeps the pin switch off and explains it when the viewer may not pin", async () => {
    mutateAsync.mockClear();
    renderDialog(false);
    const pin = screen.getByRole("switch", { name: "Ghim lên đầu trò chuyện" });
    expect(pin).toHaveAttribute("aria-disabled", "true");
    expect(pin).toHaveAccessibleDescription("Bạn không có quyền ghim nội dung lên đầu hội thoại.");

    fireEvent.change(screen.getByLabelText("Câu hỏi"), { target: { value: "Q?" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Lựa chọn 1" }), { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Lựa chọn 2" }), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo bình chọn" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const sent = mutateAsync.mock.calls.at(-1)?.[0] as { poll: { settings: { pin_to_top: boolean } } };
    expect(sent.poll.settings.pin_to_top).toBe(false);
  });

  it("hands focus to the option above a removed one", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Thêm lựa chọn" }));
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lựa chọn 3" }));
    expect(screen.getByRole("textbox", { name: "Lựa chọn 2" })).toHaveFocus();
  });

  it("states the option range, and when the maximum is reached", () => {
    renderDialog();
    expect(screen.getByText("Từ 2 đến 10 lựa chọn.")).toBeInTheDocument();
    for (let i = 0; i < 8; i += 1) fireEvent.click(screen.getByRole("button", { name: "Thêm lựa chọn" }));
    expect(screen.queryByRole("button", { name: "Thêm lựa chọn" })).toBeNull();
    expect(screen.getByText("Đã đủ 10 lựa chọn, mức tối đa của một bình chọn.")).toBeInTheDocument();
  });

  it("shows a failed send inline in the dialog", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("server words"));
    renderDialog();
    fireEvent.change(screen.getByLabelText("Câu hỏi"), { target: { value: "Q?" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Lựa chọn 1" }), { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Lựa chọn 2" }), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo bình chọn" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Không tạo được");
    expect(alert).not.toHaveTextContent("server words");
  });
});
