import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { CreateTaskManualOverflow } from "./create-task-manual-overflow";

initI18n();

describe("CreateTaskManualOverflow", () => {
  const baseProps = {
    moreFieldsLabel: "Thêm trường",
    clearLabel: "Xóa",
    parentLabel: "Task cha",
    stageLabel: "Giai đoạn",
    stageNoneLabel: "Không có giai đoạn",
    startDateLabel: "Ngày bắt đầu",
    dueDateLabel: "Hạn",
    parentSearchPlaceholder: "Tìm task cha",
    optionsNoResultsLabel: "Không có kết quả",
    parentNoneLabel: "Không có task cha",
    onClear: vi.fn(),
    parentItems: [],
    parentValue: undefined,
    onParentChange: vi.fn(),
    stageValue: undefined,
    maxSiblingStage: 0,
    onStageChange: vi.fn(),
    startDate: undefined,
    onStartDateChange: vi.fn(),
    dueDate: undefined,
    onDueDateChange: vi.fn(),
    properties: [],
    propertyValues: {},
    onPropertyChange: vi.fn(),
  };

  it("uses the shared property picker chrome for stage and dates", () => {
    const onStageChange = vi.fn();
    render(
      <CreateTaskManualOverflow
        {...baseProps}
        revealed={new Set(["stage", "start_date"])}
        onReveal={vi.fn()}
        onStageChange={onStageChange}
      />,
    );

    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    const stage = screen.getByRole("button", { name: "Giai đoạn" });
    const startDate = screen.getByRole("button", { name: "Ngày bắt đầu" });
    expect(stage).toHaveClass("rounded-full");
    expect(startDate).toHaveClass("rounded-full");

    fireEvent.click(stage);
    fireEvent.click(screen.getByRole("button", { name: "Giai đoạn 2" }));
    expect(onStageChange).toHaveBeenCalledWith("2");
  });

  it("opens a picker immediately when revealing it from more fields", async () => {
    const onReveal = vi.fn();
    const { rerender } = render(
      <CreateTaskManualOverflow {...baseProps} revealed={new Set()} onReveal={onReveal} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Thêm trường" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Giai đoạn" }));
    expect(onReveal).toHaveBeenCalledWith("stage");

    rerender(
      <CreateTaskManualOverflow
        {...baseProps}
        revealed={new Set(["stage"])}
        onReveal={onReveal}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Giai đoạn 1" })).toBeVisible(),
    );
  });

  it("offers the next stage after the selected parent's highest sibling stage", async () => {
    render(
      <CreateTaskManualOverflow
        {...baseProps}
        revealed={new Set(["stage"])}
        onReveal={vi.fn()}
        maxSiblingStage={6}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Giai đoạn" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Giai đoạn 7" })).toBeVisible(),
    );
  });
});
