import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentLeaveDialog } from "./document-leave-dialog";

const { t } = initI18n();

function renderDialog(over: Partial<Parameters<typeof DocumentLeaveDialog>[0]> = {}) {
  const handlers = { onStay: vi.fn(), onDiscard: vi.fn(), onSaveAndLeave: vi.fn() };
  render(<DocumentLeaveDialog open pending={false} caption="Chưa lưu" {...handlers} {...over} />);
  return handlers;
}

// UNI-1645 CFE-1-14: the caption changes while the dialog is open (the wait, a failed save): say it.
describe("DocumentLeaveDialog caption", () => {
  it("is a polite status for the wait and the plain remark", () => {
    renderDialog({ caption: t("documents.leave.waiting"), pending: true });
    expect(screen.getByRole("status")).toHaveTextContent(t("documents.leave.waiting"));
  });

  it("is an alert when the save failed", () => {
    renderDialog({ caption: t("documents.save.error"), failed: true });
    expect(screen.getByRole("alert")).toHaveTextContent(t("documents.save.error"));
  });

  it("keeps every choice focusable but inert (aria-disabled) while it waits", () => {
    const handlers = renderDialog({ pending: true });
    const stay = screen.getByRole("button", { name: t("documents.leave.stay") });
    expect(stay).toHaveAttribute("aria-disabled", "true");
    expect(stay).not.toBeDisabled();
    fireEvent.click(stay);
    expect(handlers.onStay).not.toHaveBeenCalled();
  });
});
