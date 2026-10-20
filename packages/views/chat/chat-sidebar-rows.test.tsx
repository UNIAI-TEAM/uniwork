import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { useChatComposerDraftStore } from "@uniwork/core/chat/composer-draft-store";
import { resetRegisteredDraftsInMemory } from "@uniwork/core/drafts/cleanup-registry";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types/user";
import { SidebarNavItem, type SidebarPreviewOptions } from "./chat-sidebar-rows";

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  setSessionUser({ id: "self", email: "self@x.vn", display_name: "Self", locale: "vi" } as User);
});

afterEach(() => {
  resetRegisteredDraftsInMemory();
  resetAuthStoreForTests();
});

const options: SidebarPreviewOptions = {
  currentUserId: "self",
  isGroup: false,
  youLabel: "Bạn",
  voiceCallLabel: "Cuộc gọi thoại",
  voiceMessageLabel: "Tin nhắn thoại",
  yesterdayLabel: "Hôm qua",
};

const preview = { body: "Cảm ơn em", senderId: "u2", createdAt: "2026-10-19T00:40:00Z" } as never;

function row(props: Partial<Parameters<typeof SidebarNavItem>[0]> = {}) {
  return render(
    <SidebarNavItem
      active={false}
      onClick={vi.fn()}
      avatar={<span />}
      title="Trần Đức Anh"
      preview={preview}
      previewOptions={options}
      unread={0}
      unreadBadgesReady
      draftKey="ws1:dm:u2"
      {...props}
    />,
  );
}

describe("SidebarNavItem", () => {
  it("shows an unsent draft in place of the last message", () => {
    useChatComposerDraftStore.getState().setDraft("ws1:dm:u2", "Gửi anh file hợp đồng\nbản cuối");
    row();
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("Nháp: Gửi anh file hợp đồng");
    expect(button).not.toHaveTextContent("bản cuối");
    expect(button).not.toHaveTextContent("Cảm ơn em");
  });

  it("keeps the last message on the open row, whose draft is in the composer", () => {
    useChatComposerDraftStore.getState().setDraft("ws1:dm:u2", "Gửi anh file hợp đồng");
    row({ active: true });
    expect(screen.getByRole("button")).toHaveTextContent("Cảm ơn em");
    expect(screen.queryByText("Nháp:")).not.toBeInTheDocument();
  });

  it("fills the open row in the brand and turns its unread badge inside out", () => {
    row({ active: true, unread: 3 });
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-current", "true");
    expect(button).toHaveClass("bg-primary");
    expect(screen.getByLabelText("3 tin nhắn chưa đọc")).toHaveClass("bg-primary-foreground", "text-primary");
  });

  it("keeps a closed row on the surface with a brand badge", () => {
    row({ unread: 3 });
    expect(screen.getByRole("button")).not.toHaveClass("bg-primary");
    expect(screen.getByLabelText("3 tin nhắn chưa đọc")).toHaveClass("bg-primary", "text-primary-foreground");
  });
});
