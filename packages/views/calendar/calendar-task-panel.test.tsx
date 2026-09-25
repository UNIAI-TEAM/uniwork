import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CalendarTaskPanel } from "./calendar-task-panel";

initI18n();

vi.mock("../tasks/detail", () => ({
  TaskDetailSuitePage: ({
    taskId,
    headerActions,
    defaultPropertiesOpen,
  }: {
    taskId: string;
    headerActions?: React.ReactNode;
    defaultPropertiesOpen?: boolean;
  }) => (
    <div
      data-testid="task-detail-suite"
      data-default-properties-open={String(defaultPropertiesOpen)}
    >
      <span>{taskId}</span>
      {headerActions}
    </div>
  ),
}));

describe("CalendarTaskPanel", () => {
  it("offers full-page navigation and closes with Escape", () => {
    const onClose = vi.fn();
    const onOpenFullPage = vi.fn();

    render(
      wrap(
        <CalendarTaskPanel
          workspaceId="ws1"
          taskId="task-1"
          onClose={onClose}
          onOpenFullPage={onOpenFullPage}
        />,
      ),
    );

    const panel = screen.getByRole("complementary", { name: "Chi tiết công việc" });
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass("2xl:w-[40rem]");
    expect(screen.getByTestId("task-detail-suite")).toHaveAttribute(
      "data-default-properties-open",
      "false",
    );
    expect(screen.getByRole("button", { name: "Đóng" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Mở toàn trang" }));
    expect(onOpenFullPage).toHaveBeenCalledWith("task-1");

    fireEvent.keyDown(screen.getByRole("complementary"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
