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

    render(
      wrap(
        <ChatConversationHeader
          avatar={<span data-testid="avatar">A</span>}
          title="Tran Hoang Long"
          subtitle="Đang hoạt động"
          settingsAriaLabel="Cài đặt"
          voiceCallAriaLabel="Gọi thoại"
          onOpenSettings={onOpenSettings}
          onVoiceCall={onVoiceCall}
        />,
      ),
    );

    expect(screen.getByText("Tran Hoang Long")).toBeInTheDocument();
    expect(screen.getByText("Đang hoạt động")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Gọi thoại"));
    fireEvent.click(screen.getByLabelText("Cài đặt"));
    expect(onVoiceCall).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
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
