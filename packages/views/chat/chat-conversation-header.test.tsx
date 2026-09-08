import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatConversationHeader } from "./chat-conversation-header";

beforeAll(() => {
  initI18n();
});

describe("ChatConversationHeader", () => {
  it("renders title, subtitle, and action buttons", () => {
    const onOpenSettings = vi.fn();
    const onVoiceCall = vi.fn();
    const onVideoCall = vi.fn();

    render(
      wrap(
        <ChatConversationHeader
          avatar={<span data-testid="avatar">A</span>}
          title="Tran Hoang Long"
          subtitle="Đang hoạt động"
          settingsAriaLabel="Cài đặt"
          voiceCallAriaLabel="Gọi thoại"
          videoCallAriaLabel="Gọi video"
          onOpenSettings={onOpenSettings}
          onVoiceCall={onVoiceCall}
          onVideoCall={onVideoCall}
        />,
      ),
    );

    expect(screen.getByText("Tran Hoang Long")).toBeInTheDocument();
    expect(screen.getByText("Đang hoạt động")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Gọi video"));
    fireEvent.click(screen.getByLabelText("Gọi thoại"));
    fireEvent.click(screen.getByLabelText("Cài đặt"));
    expect(onVideoCall).toHaveBeenCalledTimes(1);
    expect(onVoiceCall).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("calls onBack when the mobile back control is pressed", () => {
    const onBack = vi.fn();

    render(
      wrap(
        <ChatConversationHeader
          avatar={<span>A</span>}
          title="General"
          backAriaLabel="Quay lại"
          onBack={onBack}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Quay lại"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("reports the sidebar state on the collapse toggle", () => {
    const onToggleSidebar = vi.fn();

    render(
      wrap(
        <ChatConversationHeader
          avatar={<span>A</span>}
          title="General"
          sidebarCollapsed
          sidebarToggleAriaLabel="Hiện danh sách trò chuyện"
          onToggleSidebar={onToggleSidebar}
        />,
      ),
    );

    const toggle = screen.getByLabelText("Hiện danh sách trò chuyện");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  });

  it("omits optional actions when handlers are missing", () => {
    render(
      wrap(
        <ChatConversationHeader
          avatar={<span>A</span>}
          title="General"
        />,
      ),
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
