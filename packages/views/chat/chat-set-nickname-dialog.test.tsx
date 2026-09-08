import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatSetNicknameDialog } from "./chat-set-nickname-dialog";

const mutateAsync = vi.fn().mockResolvedValue(undefined);

vi.mock("@uniwork/core/chat", () => ({
  useSetChatNickname: () => ({
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

describe("ChatSetNicknameDialog", () => {
  it("saves nickname through the chat API", async () => {
    mutateAsync.mockClear();

    render(
      wrap(
        <ChatSetNicknameDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          targetUserId="u2"
          targetLabel="Binh"
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Biệt danh"), {
      target: { value: "Bạn thân" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ userId: "u2", nickname: "Bạn thân" });
    });
  });

  it("clears nickname when remove is clicked", async () => {
    mutateAsync.mockClear();

    render(
      wrap(
        <ChatSetNicknameDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          targetUserId="u2"
          targetLabel="Binh"
          currentNickname="Bạn thân"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xóa biệt danh" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ userId: "u2", nickname: "" });
    });
  });
});
