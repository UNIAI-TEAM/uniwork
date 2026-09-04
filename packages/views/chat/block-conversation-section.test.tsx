import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { BlockConversationSection } from "./block-conversation-section";

beforeAll(() => {
  initI18n();
});

describe("BlockConversationSection", () => {
  it("opens confirm dialog and blocks on confirm", () => {
    const onBlock = vi.fn().mockResolvedValue(undefined);
    render(
      wrap(
        <BlockConversationSection
          blockedByMe={false}
          blockedMe={false}
          onBlock={onBlock}
          onUnblock={vi.fn()}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Chặn nhắn tin" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Chặn nhắn tin" }));
    expect(onBlock).toHaveBeenCalledTimes(1);
  });

  it("shows unblock action when already blocked", () => {
    const onUnblock = vi.fn();
    render(
      wrap(
        <BlockConversationSection
          blockedByMe
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={onUnblock}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Bỏ chặn" }));
    expect(onUnblock).toHaveBeenCalledTimes(1);
  });

  it("disables block when the peer already blocked me", () => {
    render(
      wrap(
        <BlockConversationSection
          blockedByMe={false}
          blockedMe
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "Chặn nhắn tin" })).toBeDisabled();
    expect(screen.getByText("Người này đã chặn bạn. Bạn không thể gửi tin nhắn riêng.")).toBeInTheDocument();
  });
});
