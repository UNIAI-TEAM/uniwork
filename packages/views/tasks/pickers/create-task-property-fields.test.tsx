import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { CreateTaskAssigneeField } from "./create-task-property-fields";
import { PriorityPicker } from "./priority-picker";
import { StatusPicker } from "./status-picker";

initI18n();

describe("CreateTaskPropertyFields", () => {
  it("the create dialog's status pill is the shared StatusPicker", () => {
    requestMock.mockReturnValue(new Promise(() => {}));
    const onChange = vi.fn();
    render(
      wrap(
        <StatusPicker
          workspaceId="w1"
          appearance="pill"
          value="todo"
          ariaLabel="Trạng thái"
          onChange={onChange}
        />,
      ),
    );

    const trigger = screen.getByRole("button", { name: "Trạng thái: Cần làm" });
    expect(trigger).toHaveClass("rounded-full");
    expect(trigger.querySelector('[data-slot="status-icon"]')).not.toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Hoàn thành" }));
    expect(onChange).toHaveBeenCalledWith("done");
  });

  it("the create dialog's priority pill is the shared PriorityPicker", () => {
    const onChange = vi.fn();
    render(<PriorityPicker appearance="pill" value="none" ariaLabel="Độ ưu tiên" onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Độ ưu tiên: Không ưu tiên" });
    expect(trigger).toHaveClass("rounded-full");
    expect(trigger.querySelector('[data-slot="priority-icon"]')).not.toBeNull();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cao" }));
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
      />,
    );

    const trigger = screen.getByRole("button", { name: "Người phụ trách" });
    const avatar = trigger.querySelector('[data-slot="avatar"]');
    expect(avatar).toHaveAttribute("data-size", "default");
    expect(avatar).toHaveClass("size-4");
  });
});
