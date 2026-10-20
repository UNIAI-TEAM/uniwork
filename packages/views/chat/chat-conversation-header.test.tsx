import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatConversationHeader } from "./chat-conversation-header";

beforeAll(() => {
  initI18n();
});

describe("ChatConversationHeader", () => {
  it("renders title, subtitle, and action buttons", () => {
    const onTogglePanel = vi.fn();
    const onVoiceCall = vi.fn();
    const onVideoCall = vi.fn();

    render(
      wrap(
        <ChatConversationHeader
          avatar={<span data-testid="avatar">A</span>}
          title="Tran Hoang Long"
          subtitle="Đang hoạt động"
          panelAriaLabel="Thông tin nhóm"
          panelOpen
          voiceCallAriaLabel="Gọi thoại"
          videoCallAriaLabel="Gọi video"
          onTogglePanel={onTogglePanel}
          onVoiceCall={onVoiceCall}
          onVideoCall={onVideoCall}
        />,
      ),
    );

    expect(screen.getByText("Tran Hoang Long")).toBeInTheDocument();
    expect(screen.getByText("Đang hoạt động")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Gọi video"));
    fireEvent.click(screen.getByLabelText("Gọi thoại"));
    const panel = screen.getByRole("button", { name: "Thông tin nhóm" });
    expect(panel).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(panel);
    expect(onVideoCall).toHaveBeenCalledTimes(1);
    expect(onVoiceCall).toHaveBeenCalledTimes(1);
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it("orders the canvas actions search, call, video, panel", () => {
    render(
      wrap(
        <ChatConversationHeader
          avatar={<span>A</span>}
          title="Ra mắt UniWork Q4"
          searchAriaLabel="Tìm"
          voiceCallAriaLabel="Gọi thoại"
          videoCallAriaLabel="Gọi video"
          panelAriaLabel="Thông tin nhóm"
          panelOpen={false}
          onSearch={vi.fn()}
          onVoiceCall={vi.fn()}
          onVideoCall={vi.fn()}
          onTogglePanel={vi.fn()}
        />,
      ),
    );
    const names = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter((name) => name !== "Thêm thao tác");
    expect(names).toEqual(["Tìm", "Gọi thoại", "Gọi video", "Thông tin nhóm"]);
    expect(screen.getByRole("button", { name: "Thông tin nhóm" })).toHaveAttribute("aria-pressed", "false");
  });

  it("leads the subtitle with who is typing", () => {
    render(
      wrap(
        <ChatConversationHeader avatar={<span>A</span>} title="Q4" subtitle="12 thành viên" typingLabel="Minh đang nhập…" />,
      ),
    );
    expect(screen.getByText("Minh đang nhập…")).toHaveClass("text-primary");
    expect(screen.getByText(/12 thành viên/)).toBeInTheDocument();
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

  it("shows CatchUp when onCatchUp is provided", () => {
    const onCatchUp = vi.fn();

    render(
      wrap(
        <ChatConversationHeader
          avatar={<span>A</span>}
          title="General"
          catchUpAriaLabel="Bắt kịp"
          onCatchUp={onCatchUp}
        />,
      ),
    );

    fireEvent.click(screen.getByLabelText("Bắt kịp"));
    expect(onCatchUp).toHaveBeenCalledTimes(1);
  });

  it("names the room with a focusable h2 that shows the full name on hover", () => {
    render(wrap(<ChatConversationHeader avatar={<span>A</span>} title="Tran Hoang Long" />));
    const heading = screen.getByRole("heading", { level: 2, name: "Tran Hoang Long" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveAttribute("title", "Tran Hoang Long");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("folds the calls into the more menu on a phone, and keeps them in the row from sm", async () => {
    const onVoiceCall = vi.fn();
    render(
      wrap(
        <ChatConversationHeader
          avatar={<span>A</span>}
          title="General"
          voiceCallAriaLabel="Gọi thoại"
          videoCallAriaLabel="Gọi video"
          onVoiceCall={onVoiceCall}
          onVideoCall={vi.fn()}
        />,
      ),
    );

    // Row buttons exist for sm and up…
    expect(screen.getByRole("button", { name: "Gọi thoại" })).toHaveClass("hidden", "sm:inline-flex");
    // …and the phone's more menu carries the same actions.
    const more = screen.getByRole("button", { name: "Thêm thao tác" });
    expect(more).toHaveClass("sm:hidden");
    fireEvent.click(more);
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Gọi video" })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Gọi thoại" }));
    expect(onVoiceCall).toHaveBeenCalledTimes(1);
  });
});
