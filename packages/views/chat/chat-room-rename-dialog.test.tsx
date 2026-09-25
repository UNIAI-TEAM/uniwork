import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatRoomRenameDialog } from "./chat-room-rename-dialog";

const mutateAsync = vi.fn();

vi.mock("@uniwork/core/chat", () => ({
  useUpdateChatRoomSettings: () => ({ mutateAsync, isPending: false }),
}));

beforeAll(() => {
  initI18n();
});

function renderDialog(onOpenChange = vi.fn()) {
  render(
    wrap(
      <ChatRoomRenameDialog
        open
        onOpenChange={onOpenChange}
        workspaceId="ws1"
        roomId="room1"
        currentName="Nhóm cũ"
      />,
    ),
  );
  return onOpenChange;
}

describe("ChatRoomRenameDialog", () => {
  it("shows a failed rename next to the field instead of swallowing it", async () => {
    mutateAsync.mockRejectedValueOnce({ status: 500 });
    const onOpenChange = renderDialog();

    const input = screen.getByLabelText("Tên hiển thị");
    fireEvent.change(input, { target: { value: "Nhóm mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    expect(await screen.findByText("Không đổi được tên phòng. Thử lại.")).toHaveAttribute("role", "alert");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("ignores Enter while an IME is composing", () => {
    mutateAsync.mockClear();
    renderDialog();

    const input = screen.getByLabelText("Tên hiển thị");
    fireEvent.change(input, { target: { value: "Nhóm mới" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(mutateAsync).not.toHaveBeenCalled();

    mutateAsync.mockResolvedValueOnce(undefined);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mutateAsync).toHaveBeenCalledWith({ roomId: "room1", name: "Nhóm mới" });
  });

  it("caps the name at the server's limit and never shows the server's sentence", async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError("tên phòng tối đa 80 ký tự", "forbidden", 403));
    renderDialog();
    const input = screen.getByLabelText("Tên hiển thị");
    expect(input).toHaveAttribute("maxLength", "80");
    fireEvent.change(input, { target: { value: "Nhóm mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bạn không có quyền làm việc này.");
  });
});
