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

  // Hiding a DM on one side is undone by the next message: consequential, not destructive.
  it("does not paint leaving a DM as destructive, but still asks", () => {
    const onLeave = vi.fn().mockResolvedValue(undefined);
    render(wrap(<LeaveConversationSection variant="dm" onLeave={onLeave} />));
    const trigger = screen.getByRole("button", { name: "Rời cuộc trò chuyện" });
    expect(trigger.className).not.toMatch(/\bbg-destructive\b/);
    fireEvent.click(trigger);
    const confirm = within(screen.getByRole("alertdialog")).getByRole("button", { name: "Rời cuộc trò chuyện" });
    expect(confirm.className).not.toMatch(/\bbg-destructive\b/);
    fireEvent.click(confirm);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("keeps leaving a group destructive", () => {
    render(wrap(<LeaveConversationSection variant="group" onLeave={vi.fn()} />));
    expect(screen.getByRole("button", { name: "Rời cuộc trò chuyện" }).className).toMatch(/\bbg-destructive\b/);
  });
});
