import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateTaskStatusField, CreateTaskPriorityField } from "./create-task-property-fields";

describe("CreateTaskPropertyFields", () => {
  it("StatusField uses PillButton chrome and icon+label options", () => {
    const onChange = vi.fn();
    render(
      <CreateTaskStatusField
        items={[
          { value: "todo", label: "Cần làm", category: "todo" },
          { value: "done", label: "Hoàn thành", category: "done" },
        ]}
        value="todo"
        searchPlaceholder="Tìm trạng thái"
        noResultsLabel="Không có kết quả"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Cần làm/ });
    expect(trigger).toHaveClass("rounded-full");
    expect(trigger.querySelector('[data-slot="status-icon"]')).not.toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /Hoàn thành/ }));
    expect(onChange).toHaveBeenCalledWith("done");
  });

  it("PriorityField lists icon badges and commits on click", () => {
    const onChange = vi.fn();
    render(
      <CreateTaskPriorityField
        items={[
          { value: "none", label: "Không ưu tiên" },
          { value: "high", label: "Cao" },
        ]}
        value="none"
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Không ưu tiên/ });
    expect(trigger.querySelector('[data-slot="priority-icon"]')).not.toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /Cao/ }));
    expect(onChange).toHaveBeenCalledWith("high");
  });
});
