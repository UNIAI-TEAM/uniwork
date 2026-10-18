import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatConversationNotices } from "./chat-notice";

initI18n();

describe("ChatConversationNotices", () => {
  it("keeps one status region mounted and only changes its text", () => {
    const props = { onRetryWorkspace: vi.fn(), connectError: null };
    const { rerender } = render(<ChatConversationNotices {...props} workspaceLoadFailed={false} />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");

    rerender(<ChatConversationNotices {...props} workspaceLoadFailed />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).not.toHaveTextContent(/^$/);
  });

  it("announces a connect error as an alert", () => {
    render(
      <ChatConversationNotices
        onRetryWorkspace={vi.fn()}
        workspaceLoadFailed={false}
        connectError="Không kết nối được"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Không kết nối được");
  });
});
