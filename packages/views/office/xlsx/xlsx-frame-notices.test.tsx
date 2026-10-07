import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { XlsxFrameNotices } from "./xlsx-frame-notices";

describe("XlsxFrameNotices paste notice (MINOR-5)", () => {
  it("shows a neutral status, not the red error alert, and dismisses", () => {
    const dismiss = vi.fn();
    render(<XlsxFrameNotices recalcProgress={null} recalcError={null} editFailed={false} onCancelRecalculate={() => undefined} pasteNotice={{ message: "values only", dismiss }} />);
    const notice = screen.getByTestId("xlsx-paste-notice");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("values only");
    expect(notice.className).not.toMatch(/destructive/);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for an absent notice", () => {
    render(<XlsxFrameNotices recalcProgress={null} recalcError={null} editFailed={false} onCancelRecalculate={() => undefined} pasteNotice={null} />);
    expect(screen.queryByTestId("xlsx-paste-notice")).toBeNull();
  });
});
