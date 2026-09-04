import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { LeaveConversationSection } from "./leave-conversation-section";

beforeAll(() => {
  initI18n();
});

describe("LeaveConversationSection", () => {
  it("confirms leaving a group conversation", () => {
    const onLeave = vi.fn().mockResolvedValue(undefined);
    render(
      wrap(
        <LeaveConversationSection variant="group" onLeave={onLeave} />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rời cuộc trò chuyện" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Rời cuộc trò chuyện" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("shows dm-specific hint copy", () => {
    render(
      wrap(
        <LeaveConversationSection variant="dm" onLeave={vi.fn()} />,
      ),
    );

    expect(screen.getByText("Chỉ ẩn cuộc trò chuyện phía bạn.")).toBeInTheDocument();
  });
});
