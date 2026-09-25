import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CreateTaskAssigneeField,
  CreateTaskPriorityField,
  CreateTaskStatusField,
} from "./create-task-property-fields";

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

  it("AssigneeField always searches and groups members and agents", () => {
    const onChange = vi.fn();
    render(
      <CreateTaskAssigneeField
        value={null}
        options={[
          { id: "member-1", kind: "human", name: "Nguyễn An" },
          { id: "agent-1", kind: "agent", name: "Agent 17" },
        ]}
        onChange={onChange}
        ariaLabel="Người phụ trách"
        unassignedLabel="Chưa giao"
        searchPlaceholder="Tìm người phụ trách"
        noResultsLabel="Không có kết quả"
        valueLabel="Chưa giao"
        membersLabel="Thành viên"
        agentsLabel="Agent"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Người phụ trách" }));

    expect(screen.getByRole("textbox", { name: "Tìm người phụ trách" })).toBeInTheDocument();
    expect(screen.getByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByText("Agent", { selector: "div" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Agent 17/ }));
    expect(onChange).toHaveBeenCalledWith({ id: "agent-1", kind: "agent" });
  });

  it("AssigneeField keeps a selected avatar within the standard pill height", () => {
    render(
      <CreateTaskAssigneeField
        value={{ id: "agent-1", kind: "agent" }}
        options={[{ id: "agent-1", kind: "agent", name: "Agent 17" }]}
        onChange={vi.fn()}
        ariaLabel="Người phụ trách"
        unassignedLabel="Chưa giao"
        searchPlaceholder="Tìm người phụ trách"
        noResultsLabel="Không có kết quả"
        valueLabel="Agent 17"
        membersLabel="Thành viên"
        agentsLabel="Agent"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Người phụ trách" });
    const avatar = trigger.querySelector('[data-slot="avatar"]');
    expect(avatar).toHaveAttribute("data-size", "default");
    expect(avatar).toHaveClass("size-4");
  });
});
