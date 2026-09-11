import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatCreatePostDialog } from "./chat-create-post-dialog";

initI18n();

vi.mock("@uniwork/core/chat", () => ({
  useSendChatRoomMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe("ChatCreatePostDialog", () => {
  it("requires title and body before submit is enabled", () => {
    render(
      <ChatCreatePostDialog
        open
        onOpenChange={() => undefined}
        workspaceId="w1"
        roomId="r1"
        canPinToTop
      />,
    );

    expect(screen.getByRole("button", { name: /Đăng bài|Publish post/i })).toBeDisabled();
  });
});
