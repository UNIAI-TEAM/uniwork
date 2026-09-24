import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatConversationNotices } from "./chat-notice";

describe("ChatConversationNotices", () => {
  it("keeps one status region mounted and only changes its text", () => {
    const props = { onRetryWorkspace: vi.fn(), connectError: null };
    const { rerender } = render(<ChatConversationNotices {...props} workspaceLoadFailed={false} blockedNotice={null} />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");

    rerender(<ChatConversationNotices {...props} workspaceLoadFailed={false} blockedNotice="Bạn đã chặn người này" />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Bạn đã chặn người này");
  });

  it("announces a connect error as an alert", () => {
    render(
      <ChatConversationNotices
        onRetryWorkspace={vi.fn()}
        workspaceLoadFailed={false}
        connectError="Không kết nối được"
        blockedNotice={null}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Không kết nối được");
  });
});
