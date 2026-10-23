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

  it("shows the option colour dot beside a property group's name", () => {
    render(
      <table>
        <tbody>
          <TaskTableGroupRow
            group={{ kind: "group", key: "property:p1:o1", label: "Cao", count: 2, collapsed: false }}
            color="#ef4444"
            colSpan={3}
            onToggle={vi.fn()}
          />
        </tbody>
      </table>,
    );
    const button = screen.getByRole("button", { name: /Cao\s*2/ });
    expect(button.querySelector("[data-slot='group-color']")).toHaveClass("bg-tint-red-solid");
  });

  it("shows no dot without a colour", () => {
    render(
      <table>
        <tbody>
          <TaskTableGroupRow
            group={{ kind: "group", key: "status:todo", label: "To do", count: 1, collapsed: false }}
            colSpan={3}
            onToggle={vi.fn()}
          />
        </tbody>
      </table>,
    );
    expect(document.querySelector("[data-slot='group-color']")).toBeNull();
  });
});
