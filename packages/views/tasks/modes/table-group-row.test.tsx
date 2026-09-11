import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { TaskTableGroupRow } from "./table-group-row";

initI18n();

describe("TaskTableGroupRow", () => {
  it("keeps full-width row controls sticky during horizontal scrolling", () => {
    const onToggle = vi.fn();
    render(
      <table>
        <tbody>
          <TaskTableGroupRow
            group={{
              kind: "group",
              key: "status:todo",
              label: "To do",
              count: 13,
              collapsed: false,
            }}
            colSpan={3}
            onToggle={onToggle}
          />
        </tbody>
      </table>,
    );

    const group = screen.getByRole("button", { name: /To do\s*13/ });
    expect(group).toHaveClass("sticky", "left-4", "w-fit");

    fireEvent.click(group);
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
