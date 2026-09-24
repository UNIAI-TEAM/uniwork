import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatCreatePostDialog } from "./chat-create-post-dialog";

initI18n();

const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/chat", () => ({
  useSendChatRoomMessage: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const dialog = (canPinToTop = true) => (
  <ChatCreatePostDialog open onOpenChange={() => undefined} workspaceId="w1" roomId="r1" canPinToTop={canPinToTop} />
);

describe("ChatCreatePostDialog", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ id: "m1" });
  });

  it("requires title and body before submit is enabled, and says which is missing", () => {
    render(dialog());

    expect(screen.getByRole("button", { name: /Đăng bài|Publish post/i })).toBeDisabled();
    expect(screen.getByText("Cần tiêu đề và nội dung")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Tiêu đề/ }), { target: { value: "Release" } });
    expect(screen.getByText("Cần nội dung")).toBeInTheDocument();
  });

  // The fields sit in a real <form>, so Enter in the title submits it natively
  // (jsdom does not do implicit submission; the submit event stands in for it).
  it("submits through the form once both fields are filled", async () => {
    render(dialog());
    fireEvent.change(screen.getByRole("textbox", { name: /Nội dung/ }), { target: { value: "Chi tiết" } });
    const title = screen.getByRole("textbox", { name: /Tiêu đề/ });
    fireEvent.change(title, { target: { value: "Release 1.4" } });
    expect(title.closest("form")).not.toBeNull();
    fireEvent.submit(title.closest("form")!);
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ post: { title: "Release 1.4", body: "Chi tiết", pin_to_top: false } }),
      ),
    );
  });

  it("does not submit on the Enter that confirms an IME word", () => {
    render(dialog());
    fireEvent.change(screen.getByRole("textbox", { name: /Nội dung/ }), { target: { value: "Chi tiết" } });
    const title = screen.getByRole("textbox", { name: /Tiêu đề/ });
    fireEvent.change(title, { target: { value: "Tiếng Việt" } });
    const composing = fireEvent.keyDown(title, { key: "Enter", keyCode: 229 });
    expect(composing).toBe(false);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("shows a failed send inline, next to the button", async () => {
    mutateAsync.mockRejectedValue(new Error("server said something"));
    render(dialog());
    fireEvent.change(screen.getByRole("textbox", { name: /Tiêu đề/ }), { target: { value: "Release" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Nội dung/ }), { target: { value: "Chi tiết" } });
    fireEvent.click(screen.getByRole("button", { name: /Đăng bài/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("server said something");
    expect(alert.textContent).not.toBe("");
  });
});
